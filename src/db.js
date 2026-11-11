import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Har bir migratsiya faqat bir marta bajariladi (PRAGMA user_version orqali kuzatiladi).
export const MIGRATIONS = [
  `
  CREATE TABLE organizations (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    org_id        INTEGER NOT NULL REFERENCES organizations(id),
    pos           TEXT,
    role          TEXT NOT NULL CHECK (role IN ('admin','operator','viewer','user')),
    code          TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    active        INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    number     TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    org_id     INTEGER NOT NULL REFERENCES organizations(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    priority   TEXT NOT NULL DEFAULT 'normal'
  );
  CREATE INDEX idx_documents_created ON documents(created_at, id);
  CREATE TABLE tasks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    issued_by INTEGER NOT NULL REFERENCES users(id),
    deadline  TEXT NOT NULL
  );
  CREATE INDEX idx_tasks_doc ON tasks(doc_id);
  CREATE TABLE assignees (
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
  CREATE INDEX idx_assignees_user ON assignees(user_id);
  CREATE TABLE signatures (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    ord       INTEGER NOT NULL,
    signed_at TEXT,
    UNIQUE (doc_id, user_id)
  );
  CREATE INDEX idx_signatures_user ON signatures(user_id);
  CREATE TABLE transfers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    from_org    INTEGER NOT NULL REFERENCES organizations(id),
    to_org      INTEGER NOT NULL REFERENCES organizations(id),
    sent_at     TEXT NOT NULL,
    received_at TEXT
  );
  CREATE INDEX idx_transfers_doc ON transfers(doc_id);
  CREATE TABLE sms_queue (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    to_name TEXT NOT NULL,
    to_phone TEXT,
    text    TEXT NOT NULL,
    at      TEXT NOT NULL,
    status  TEXT NOT NULL DEFAULT 'navbatda',
    error   TEXT
  );
  CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    user_id   INTEGER,
    action    TEXT NOT NULL,
    entity    TEXT,
    entity_id INTEGER,
    details   TEXT,
    ip        TEXT
  );
  CREATE INDEX idx_audit_at ON audit_log(id DESC);
  CREATE TABLE refresh_tokens (
    jti        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE integration_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_notif_user ON notifications(user_id, read, id DESC);
  CREATE TABLE doc_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    event_type TEXT NOT NULL,
    details    TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_events_doc ON doc_events(doc_id, id);
  `,
  `
  ALTER TABLE users ADD COLUMN department TEXT;
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE documents ADD COLUMN department TEXT;
  CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    assignee_id INTEGER REFERENCES assignees(id) ON DELETE CASCADE,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL DEFAULT 'document' CHECK (kind IN ('document', 'response')),
    orig_name   TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    data        BLOB NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_attachments_doc ON attachments(doc_id);
  CREATE INDEX idx_attachments_assignee ON attachments(assignee_id);
  `,
  `
  ALTER TABLE attachments ADD COLUMN note TEXT;
  ALTER TABLE notifications ADD COLUMN doc_id INTEGER REFERENCES documents(id) ON DELETE CASCADE;
  `,
];

export function migrate(db) {
  let v = db.prepare('PRAGMA user_version').get().user_version;
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return v;
}

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
