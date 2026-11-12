import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client/web';

const REMOTE_RE = /^(libsql|https?|wss?):\/\//i;

// Har bir migratsiya faqat bir marta bajariladi (SQLite: PRAGMA user_version; Turso: schema_meta jadvali).
export const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS organizations (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    org_id        INTEGER NOT NULL REFERENCES organizations(id),
    pos           TEXT,
    role          TEXT NOT NULL CHECK (role IN ('admin','operator','viewer','user')),
    code          TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    active        INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    number     TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    org_id     INTEGER NOT NULL REFERENCES organizations(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    priority   TEXT NOT NULL DEFAULT 'normal'
  );
  CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at, id);
  CREATE TABLE IF NOT EXISTS tasks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    issued_by INTEGER NOT NULL REFERENCES users(id),
    deadline  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_doc ON tasks(doc_id);
  CREATE TABLE IF NOT EXISTS assignees (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    assigned_by     INTEGER NOT NULL REFERENCES users(id),
    assigned_at     TEXT NOT NULL,
    done_date       TEXT,
    viewed_at       TEXT,
    delegated_to    INTEGER REFERENCES users(id),
    delegated_at    TEXT,
    delegation_note TEXT,
    UNIQUE (task_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_assignees_user ON assignees(user_id);
  CREATE TABLE IF NOT EXISTS signatures (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    ord       INTEGER NOT NULL,
    signed_at TEXT,
    UNIQUE (doc_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_signatures_user ON signatures(user_id);
  CREATE TABLE IF NOT EXISTS transfers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    from_org    INTEGER NOT NULL REFERENCES organizations(id),
    to_org      INTEGER NOT NULL REFERENCES organizations(id),
    sent_at     TEXT NOT NULL,
    received_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_transfers_doc ON transfers(doc_id);
  CREATE TABLE IF NOT EXISTS sms_queue (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    to_name  TEXT NOT NULL,
    to_phone TEXT,
    text     TEXT NOT NULL,
    at       TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'navbatda',
    error    TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    user_id   INTEGER,
    action    TEXT NOT NULL,
    entity    TEXT,
    entity_id INTEGER,
    details   TEXT,
    ip        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(id DESC);
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS integration_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, id DESC);
  CREATE TABLE IF NOT EXISTS doc_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    event_type TEXT NOT NULL,
    details    TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_doc ON doc_events(doc_id, id);
  `,
  `
  ALTER TABLE users ADD COLUMN department TEXT;
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE documents ADD COLUMN department TEXT;
  CREATE TABLE IF NOT EXISTS attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    assignee_id INTEGER REFERENCES assignees(id) ON DELETE CASCADE,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL DEFAULT 'document' CHECK (kind IN ('document', 'response')),
    orig_name   TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    data        BLOB,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_doc ON attachments(doc_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_assignee ON attachments(assignee_id);
  `,
  `
  ALTER TABLE attachments ADD COLUMN note TEXT;
  ALTER TABLE notifications ADD COLUMN doc_id INTEGER REFERENCES documents(id) ON DELETE CASCADE;
  `,
  `
  ALTER TABLE users ADD COLUMN created_at TEXT;
  UPDATE users SET created_at = date('now') WHERE created_at IS NULL;
  `,
  `
  ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
  ALTER TABLE users ADD COLUMN telegram_username TEXT;
  CREATE INDEX IF NOT EXISTS idx_users_tg_chat ON users(telegram_chat_id);
  ALTER TABLE assignees ADD COLUMN completion_note TEXT;
  ALTER TABLE assignees ADD COLUMN done_at TEXT;
  ALTER TABLE attachments ADD COLUMN tg_file_id TEXT;
  ALTER TABLE attachments ADD COLUMN tg_message_id INTEGER;
  ALTER TABLE attachments ADD COLUMN tg_chat_id TEXT;
  CREATE TABLE IF NOT EXISTS telegram_chats (
    chat_id    TEXT PRIMARY KEY,
    username   TEXT,
    first_name TEXT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  );
  `,
];

function normalizeValue(v) {
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v) && !(v instanceof Buffer)) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v;
  }
  return v;
}

function normalizeRow(columns, row) {
  if (!row) return undefined;
  const out = {};
  if (Array.isArray(columns) && columns.length) {
    for (const c of columns) out[c] = normalizeValue(row[c]);
  } else {
    for (const [k, v] of Object.entries(row)) {
      if (/^\d+$/.test(k)) continue;
      out[k] = normalizeValue(v);
    }
  }
  return out;
}

function normalizeArgs(args) {
  return args.map((v) => {
    if (v === undefined) return null;
    if (Buffer.isBuffer(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return v;
  });
}

function sqliteRow(row) {
  if (!row) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
}

export function wrapSqlite(sqliteDb) {
  let txQueue = Promise.resolve();
  const adapter = {
    driver: 'sqlite',
    raw: sqliteDb,
    async get(sql, ...args) {
      return sqliteRow(sqliteDb.prepare(sql).get(...args));
    },
    async all(sql, ...args) {
      return sqliteDb.prepare(sql).all(...args).map(sqliteRow);
    },
    async run(sql, ...args) {
      const r = sqliteDb.prepare(sql).run(...args);
      return {
        changes: Number(r.changes ?? 0),
        lastInsertRowid: Number(r.lastInsertRowid ?? 0),
      };
    },
    async exec(sql) {
      sqliteDb.exec(sql);
    },
    tx(fn) {
      const run = async () => {
        sqliteDb.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(adapter);
          sqliteDb.exec('COMMIT');
          return out;
        } catch (e) {
          try { sqliteDb.exec('ROLLBACK'); } catch { /* allaqachon bekor qilingan */ }
          throw e;
        }
      };
      const next = txQueue.then(run, run);
      txQueue = next.catch(() => {});
      return next;
    },
    close() {
      sqliteDb.close();
    },
  };
  return adapter;
}

function wrapLibsqlTarget(target) {
  return {
    async get(sql, ...args) {
      const rs = await target.execute({ sql, args: normalizeArgs(args) });
      return rs.rows.length ? normalizeRow(rs.columns, rs.rows[0]) : undefined;
    },
    async all(sql, ...args) {
      const rs = await target.execute({ sql, args: normalizeArgs(args) });
      return rs.rows.map((r) => normalizeRow(rs.columns, r));
    },
    async run(sql, ...args) {
      const rs = await target.execute({ sql, args: normalizeArgs(args) });
      return {
        changes: Number(rs.rowsAffected ?? 0),
        lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : 0,
      };
    },
    async exec(sql) {
      if (typeof target.executeMultiple === 'function') {
        await target.executeMultiple(sql);
        return;
      }
      // Ba'zi mock/clientlarda executeMultiple bo'lmasa gaplarni ketma-ket bajaramiz
      const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
      for (const s of stmts) await target.execute({ sql: s, args: [] });
    },
  };
}

export function wrapLibsqlClient(client) {
  const base = wrapLibsqlTarget(client);
  const adapter = {
    driver: 'turso',
    raw: client,
    ...base,
    async tx(fn) {
      const t = await client.transaction('write');
      const txAdapter = { driver: 'turso', raw: t, ...wrapLibsqlTarget(t) };
      try {
        const out = await fn(txAdapter);
        await t.commit();
        return out;
      } catch (e) {
        try { await t.rollback(); } catch { /* allaqachon bekor qilingan */ }
        throw e;
      } finally {
        try { t.close?.(); } catch { /* noop */ }
      }
    },
    close() {
      return client.close?.();
    },
  };
  return adapter;
}

async function ensureColumns(db) {
  const needed = [
    ['users', 'department', 'TEXT'],
    ['users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
    ['users', 'created_at', 'TEXT'],
    ['users', 'telegram_chat_id', 'TEXT'],
    ['users', 'telegram_username', 'TEXT'],
    ['documents', 'department', 'TEXT'],
    ['assignees', 'completion_note', 'TEXT'],
    ['assignees', 'done_at', 'TEXT'],
    ['notifications', 'doc_id', 'INTEGER REFERENCES documents(id) ON DELETE CASCADE'],
    ['attachments', 'note', 'TEXT'],
    ['attachments', 'tg_file_id', 'TEXT'],
    ['attachments', 'tg_message_id', 'INTEGER'],
    ['attachments', 'tg_chat_id', 'TEXT'],
  ];

  const colsByTable = new Map();
  for (const [table, col, def] of needed) {
    if (!colsByTable.has(table)) {
      const rows = await db.all(`PRAGMA table_info(${table})`);
      colsByTable.set(table, rows);
    }
    const cols = colsByTable.get(table);
    if (!cols.length) continue;
    if (!cols.some((c) => c.name === col)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      cols.push({ name: col, notnull: 0 });
    }
  }

  // Eski bazalarda attachments.data NOT NULL bo'lsa, Telegram arxividan NULL saqlash uchun moslaymiz
  const attCols = colsByTable.get('attachments') || [];
  const dataCol = attCols.find((c) => c.name === 'data');
  if (dataCol && Number(dataCol.notnull) === 1) {
    await db.tx(async (tdb) => {
      await tdb.exec(`
        CREATE TABLE attachments_v2 (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id        INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          assignee_id   INTEGER REFERENCES assignees(id) ON DELETE CASCADE,
          uploaded_by   INTEGER NOT NULL REFERENCES users(id),
          kind          TEXT NOT NULL DEFAULT 'document' CHECK (kind IN ('document', 'response')),
          orig_name     TEXT NOT NULL,
          mime_type     TEXT NOT NULL,
          size_bytes    INTEGER NOT NULL,
          note          TEXT,
          data          BLOB,
          tg_file_id    TEXT,
          tg_message_id INTEGER,
          tg_chat_id    TEXT,
          created_at    TEXT NOT NULL
        );
        INSERT INTO attachments_v2 (id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, data, tg_file_id, tg_message_id, tg_chat_id, created_at)
        SELECT id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, data, tg_file_id, tg_message_id, tg_chat_id, created_at FROM attachments;
        DROP TABLE attachments;
        ALTER TABLE attachments_v2 RENAME TO attachments;
        CREATE INDEX IF NOT EXISTS idx_attachments_doc ON attachments(doc_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_assignee ON attachments(assignee_id);
      `);
    });
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_tg_chat ON users(telegram_chat_id);
    CREATE TABLE IF NOT EXISTS telegram_chats (
      chat_id    TEXT PRIMARY KEY,
      username   TEXT,
      first_name TEXT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function migrate(db) {
  if (db.driver === 'turso') {
    await db.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    const meta = await db.get('SELECT version FROM schema_meta WHERE id = 1');
    let v = meta ? Number(meta.version) : 0;
    if (!meta) {
      // Agar PRAGMA user_version allaqachon yozilgan bo'lsa hisobga olamiz
      try {
        const uv = await db.get('PRAGMA user_version');
        if (uv && Number(uv.user_version) > 0) v = Number(uv.user_version);
      } catch { /* Turso HTTP da user_version bo'lmasligi mumkin */ }
      await db.run('INSERT OR IGNORE INTO schema_meta (id, version) VALUES (1, ?)', v);
    }
    while (v < MIGRATIONS.length) {
      await db.tx(async (tdb) => {
        await tdb.exec(MIGRATIONS[v]);
        v += 1;
        await tdb.run('INSERT OR REPLACE INTO schema_meta (id, version) VALUES (1, ?)', v);
      });
    }
    await ensureColumns(db);
    return v;
  }

  const uvRow = await db.get('PRAGMA user_version');
  let v = Number(uvRow?.user_version ?? 0);
  while (v < MIGRATIONS.length) {
    await db.tx(async (tdb) => {
      await tdb.exec(MIGRATIONS[v]);
      v += 1;
      await tdb.exec(`PRAGMA user_version = ${v}`);
    });
  }
  await ensureColumns(db);
  return v;
}

export async function openDb(target = ':memory:', options = {}) {
  if (options.client) {
    const db = wrapLibsqlClient(options.client);
    await migrate(db);
    return db;
  }

  let tursoUrl = options.tursoUrl || '';
  let tursoAuthToken = options.tursoAuthToken || '';
  let dbPath = ':memory:';

  if (target && typeof target === 'object') {
    tursoUrl = String(target.tursoUrl || '').trim();
    tursoAuthToken = String(target.tursoAuthToken || '').trim();
    dbPath = target.dbPath || './data/app.db';
  } else {
    const str = String(target || ':memory:');
    if (REMOTE_RE.test(str)) tursoUrl = str;
    else dbPath = str;
  }

  if (tursoUrl) {
    const client = createClient({
      url: tursoUrl,
      authToken: tursoAuthToken || undefined,
    });
    const db = wrapLibsqlClient(client);
    await migrate(db);
    return db;
  }

  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA foreign_keys = ON');
  if (dbPath !== ':memory:') sqliteDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL');
  const db = wrapSqlite(sqliteDb);
  await migrate(db);
  return db;
}

export async function tx(db, fn) {
  return db.tx(fn);
}
