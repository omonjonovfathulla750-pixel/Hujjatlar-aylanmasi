import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, migrate, openDb, tx } from '../../src/db.js';
import { DatabaseSync } from 'node:sqlite';

const seedOrg = (db) => db.prepare("INSERT INTO organizations (name) VALUES ('O1')").run();
const seedUser = (db, code = 'U1', role = 'user') =>
  db.prepare('INSERT INTO users (name, org_id, role, code) VALUES (?,?,?,?)').run('Ism', 1, role, code);

test('migratsiya: user_version belgilanadi va qayta ishga tushirish xavfsiz', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  assert.equal(migrate(db), MIGRATIONS.length); // ikkinchi marta hech narsa qilmaydi
  db.close();
});

test('fayl bazasi: qayta ochilganda ma‘lumotlar saqlanadi, WAL va foreign_keys yoqilgan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hujjat-db-'));
  try {
    const path = join(dir, 'sub', 'a.db'); // papka avtomatik yaratiladi
    let db = openDb(path);
    seedOrg(db);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.close();
    db = openDb(path);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM organizations').get().n, 1);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migratsiya xatosi tranzaksiyani bekor qiladi (yarim holat qolmaydi)', () => {
  const db = new DatabaseSync(':memory:');
  MIGRATIONS.push('CREATE TABLE yarim (id INTEGER); THIS IS NOT SQL;');
  try {
    assert.throws(() => migrate(db));
  } finally { MIGRATIONS.pop(); }
  // 1-migratsiya to‘liq o‘tgan, buzuq 2-migratsiya iz qoldirmagan
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='yarim'").get(), undefined);
  db.close();
});

test('cheklovlar: rol CHECK, UNIQUE kod, FOREIGN KEY', () => {
  const db = openDb(':memory:');
  seedOrg(db);
  assert.throws(() => seedUser(db, 'X', 'superuser'), /CHECK/);
  seedUser(db, 'U1');
  assert.throws(() => seedUser(db, 'U1'), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO users (name, org_id, role, code) VALUES (?,?,?,?)').run('a', 999, 'user', 'Z'), /FOREIGN KEY/);
  db.close();
});

test('hujjat o‘chirilganda topshiriq, bajaruvchi, imzo, almashinuv ham o‘chadi (CASCADE)', () => {
  const db = openDb(':memory:');
  seedOrg(db);
  db.prepare("INSERT INTO organizations (name) VALUES ('O2')").run();
  seedUser(db);
  db.prepare("INSERT INTO documents (number,type,title,org_id,created_by,created_at) VALUES ('1','Xat','t',1,1,'2026-01-01')").run();
  db.prepare("INSERT INTO tasks (doc_id,title,issued_by,deadline) VALUES (1,'t',1,'2026-02-01')").run();
  db.prepare("INSERT INTO assignees (task_id,user_id,assigned_by,assigned_at) VALUES (1,1,1,'2026-01-01')").run();
  db.prepare("INSERT INTO signatures (doc_id,user_id,ord) VALUES (1,1,1)").run();
  db.prepare("INSERT INTO transfers (doc_id,from_org,to_org,sent_at) VALUES (1,1,2,'2026-01-02')").run();
  db.prepare('DELETE FROM documents WHERE id = 1').run();
  for (const t of ['tasks', 'assignees', 'signatures', 'transfers']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
  }
  db.close();
});

test('tx: muvaffaqiyatda commit, xatoda rollback va xato qayta tashlanadi', () => {
  const db = openDb(':memory:');
  assert.equal(tx(db, () => { seedOrg(db); return 42; }), 42);
  assert.throws(() => tx(db, () => {
    db.prepare("INSERT INTO organizations (name) VALUES ('O2')").run();
    throw new Error('boom');
  }), /boom/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM organizations').get().n, 1);
  db.close();
});
