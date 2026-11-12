import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, migrate, openDb, tx, wrapSqlite } from '../../src/db.js';
import { DatabaseSync } from 'node:sqlite';

const seedOrg = (db) => db.run("INSERT INTO organizations (name) VALUES ('O1')");
const seedUser = (db, code = 'U1', role = 'user') =>
  db.run('INSERT INTO users (name, org_id, role, code) VALUES (?,?,?,?)', 'Ism', 1, role, code);

test('migratsiya: user_version belgilanadi va qayta ishga tushirish xavfsiz', async () => {
  const db = await openDb(':memory:');
  assert.equal((await db.get('PRAGMA user_version')).user_version, MIGRATIONS.length);
  assert.equal(await migrate(db), MIGRATIONS.length); // ikkinchi marta hech narsa qilmaydi
  await db.close();
});

test('fayl bazasi: qayta ochilganda ma‘lumotlar saqlanadi, WAL va foreign_keys yoqilgan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hujjat-db-'));
  try {
    const path = join(dir, 'sub', 'a.db'); // papka avtomatik yaratiladi
    let db = await openDb(path);
    await seedOrg(db);
    assert.equal((await db.get('PRAGMA journal_mode')).journal_mode, 'wal');
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
    await db.close();
    db = await openDb(path);
    assert.equal((await db.get('SELECT COUNT(*) n FROM organizations')).n, 1);
    await db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migratsiya xatosi tranzaksiyani bekor qiladi (yarim holat qolmaydi)', async () => {
  const db = wrapSqlite(new DatabaseSync(':memory:'));
  MIGRATIONS.push('CREATE TABLE yarim (id INTEGER); THIS IS NOT SQL;');
  try {
    await assert.rejects(() => migrate(db));
  } finally { MIGRATIONS.pop(); }
  // oldingi migratsiyalar to‘liq o‘tgan, buzuq oxirgi migratsiya iz qoldirmagan
  assert.equal((await db.get('PRAGMA user_version')).user_version, MIGRATIONS.length);
  assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name='yarim'"), undefined);
  await db.close();
});

test('cheklovlar: rol CHECK, UNIQUE kod, FOREIGN KEY', async () => {
  const db = await openDb(':memory:');
  await seedOrg(db);
  await assert.rejects(() => seedUser(db, 'X', 'superuser'), /CHECK/);
  await seedUser(db, 'U1');
  await assert.rejects(() => seedUser(db, 'U1'), /UNIQUE/);
  await assert.rejects(() => db.run('INSERT INTO users (name, org_id, role, code) VALUES (?,?,?,?)', 'a', 999, 'user', 'Z'), /FOREIGN KEY/);
  await db.close();
});

test('hujjat o‘chirilganda topshiriq, bajaruvchi, imzo, almashinuv ham o‘chadi (CASCADE)', async () => {
  const db = await openDb(':memory:');
  await seedOrg(db);
  await db.run("INSERT INTO organizations (name) VALUES ('O2')");
  await seedUser(db);
  await db.run("INSERT INTO documents (number,type,title,org_id,created_by,created_at) VALUES ('1','Xat','t',1,1,'2026-01-01')");
  await db.run("INSERT INTO tasks (doc_id,title,issued_by,deadline) VALUES (1,'t',1,'2026-02-01')");
  await db.run("INSERT INTO assignees (task_id,user_id,assigned_by,assigned_at) VALUES (1,1,1,'2026-01-01')");
  await db.run("INSERT INTO signatures (doc_id,user_id,ord) VALUES (1,1,1)");
  await db.run("INSERT INTO transfers (doc_id,from_org,to_org,sent_at) VALUES (1,1,2,'2026-01-02')");
  await db.run('DELETE FROM documents WHERE id = 1');
  for (const t of ['tasks', 'assignees', 'signatures', 'transfers']) {
    assert.equal((await db.get(`SELECT COUNT(*) n FROM ${t}`)).n, 0, t);
  }
  await db.close();
});

test('tx: muvaffaqiyatda commit, xatoda rollback va xato qayta tashlanadi', async () => {
  const db = await openDb(':memory:');
  assert.equal(await tx(db, async () => { await seedOrg(db); return 42; }), 42);
  await assert.rejects(() => tx(db, async () => {
    await db.run("INSERT INTO organizations (name) VALUES ('O2')");
    throw new Error('boom');
  }), /boom/);
  assert.equal((await db.get('SELECT COUNT(*) n FROM organizations')).n, 1);
  await db.close();
});
