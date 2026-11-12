import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db.js';
import { createRepo } from '../../src/repo.js';
import { seedBase, seedDemo, USERS } from '../../src/seed.js';
import { verifyPassword } from '../../src/auth.js';
import { runUserAdmin } from '../../scripts/user-admin.js';
import { testConfig } from '../helpers.js';

const mk = async () => { const db = await openDb(':memory:'); return { db, repo: createRepo(db) }; };

test('seedBase: tashkilot va xodimlar bir marta yaratiladi (idempotent), parollar heshlangan', async () => {
  const { db, repo } = await mk();
  try {
    const cfg = testConfig();
    await seedBase(repo, cfg);
    await seedBase(repo, cfg);
    assert.equal(await repo.countOrgs(), 4);
    assert.equal(await repo.countUsers(), USERS.length);
    const admin = await repo.userByCode('admin');
    assert.notEqual(admin.password_hash, cfg.adminPassword);
    assert.equal(verifyPassword(cfg.adminPassword, admin.password_hash), true);
    assert.equal(verifyPassword(cfg.demoPassword, (await repo.userByCode('U001')).password_hash), true);
  } finally { await db.close(); }
});

test('seedBase: DEMO_PASSWORD yo‘q bo‘lsa oddiy xodimlar kira olmaydi; admin parolsiz bo‘lsa env’dan o‘rnatiladi', async () => {
  const { repo, db } = await mk();
  try {
    await seedBase(repo, { ...testConfig(), demoPassword: '' });
    assert.equal((await repo.userByCode('U001')).password_hash, null);
    await db.run("UPDATE users SET password_hash = NULL WHERE code = 'admin'");
    await seedBase(repo, testConfig());
    assert.ok((await repo.userByCode('admin')).password_hash);
  } finally { await db.close(); }
});

test('seedBase: development rejimida admin va U001 12345678 paroli bilan yaratiladi (mavjud bazaga ham U001 qo‘shiladi)', async () => {
  const { loadConfig } = await import('../../src/config.js');
  const { db, repo } = await mk();
  const { db: db2, repo: repo2 } = await mk();
  const { db: db3, repo: repo3 } = await mk();
  try {
    const devCfg = loadConfig({ NODE_ENV: 'development' });
    await seedBase(repo, devCfg);
    assert.equal(await repo.countUsers(), 2);
    const admUser = await repo.userByCode('admin');
    const u001User = await repo.userByCode('U001');
    assert.equal(verifyPassword('12345678', admUser.password_hash), true);
    assert.equal(verifyPassword('12345678', u001User.password_hash), true);

    // Eski bazada faqat admin bo'lsa ham U001 qo'shiladi
    await repo2.insertOrg('Ichki ishlar vazirligi');
    await repo2.insertUser({ name: 'Administrator', org_id: 1, pos: 'Admin', role: 'admin', code: 'admin', password_hash: admUser.password_hash });
    await seedBase(repo2, devCfg);
    assert.equal(await repo2.countUsers(), 2);
    assert.equal(verifyPassword('12345678', (await repo2.userByCode('U001')).password_hash), true);

    // Ko'p foydalanuvchisi bor mavjud bazada ham U001 yaratiladi va admin/U001 qayta faollashtiriladi
    await repo3.insertOrg('Ichki ishlar vazirligi');
    const admId = await repo3.insertUser({ name: 'Administrator', org_id: 1, pos: 'Admin', role: 'admin', code: 'admin', password_hash: admUser.password_hash });
    await repo3.insertUser({ name: 'Xodim 2', org_id: 1, pos: 'Mutaxassis', role: 'user', code: 'U002', password_hash: u001User.password_hash });
    await repo3.insertUser({ name: 'Xodim 3', org_id: 1, pos: 'Mutaxassis', role: 'user', code: 'U003', password_hash: u001User.password_hash });
    await repo3.setActive(admId, false);
    await seedBase(repo3, devCfg);
    assert.equal((await repo3.userByCode('admin')).active, 1);
    assert.equal((await repo3.userByCode('U001')).active, 1);
    assert.equal(verifyPassword('12345678', (await repo3.userByCode('U001')).password_hash), true);
    await repo3.setActive((await repo3.userByCode('U001')).id, false);
    await seedBase(repo3, devCfg);
    assert.equal((await repo3.userByCode('U001')).active, 1);
  } finally { await db.close(); await db2.close(); await db3.close(); }
});

test('seedDemo: deterministik, qayta ishlatilganda yangi hujjat qo‘shmaydi', async () => {
  const run = async () => { const { db, repo } = await mk(); await seedBase(repo, testConfig()); const n = await seedDemo(db, repo, { today: '2026-11-07' }); return { n, repo, db }; };
  const a = await run();
  const b = await run();
  try {
    assert.ok(a.n > 100);
    assert.equal(a.n, b.n);
    assert.deepEqual((await a.repo.findDocs()).map((d) => d.number), (await b.repo.findDocs()).map((d) => d.number));
    assert.equal(await seedDemo(a.db, a.repo, { today: '2026-11-07' }), 0);
  } finally { await a.db.close(); await b.db.close(); }
});

test('seedDemo: ma‘lumot butunligi (kelajakdagi sana yo‘q, imzolar va bajarilishlar mantiqiy)', async () => {
  const { db, repo } = await mk();
  try {
    await seedBase(repo, testConfig());
    await seedDemo(db, repo, { today: '2026-11-07' });
    const docs = await repo.findDocs();
    const SEED = '2026-11-06';
    for (const d of docs) {
      assert.ok(d.created_at <= SEED, d.number);
      for (const s of d.signatures) assert.ok(!s.signed_at || s.signed_at <= SEED);
      for (const t of d.tasks) for (const a of t.assignees) assert.ok(!a.done_date || (a.done_date <= SEED && a.done_date >= d.created_at));
      for (const tr of d.transfers) assert.notEqual(tr.to_org, tr.from_org);
    }
    // kamida bitta muddati o‘tgan topshiriq va bitta biriktirilmagan topshiriq bo‘lishi kerak (dashboard uchun)
    const tasks = docs.flatMap((d) => d.tasks);
    assert.ok(tasks.some((t) => t.deadline < '2026-11-07' && t.assignees.some((a) => !a.done_date)));
    assert.ok(tasks.some((t) => t.assignees.length === 0));
  } finally { await db.close(); }
});

test('user-admin CLI: parol va rolni o‘zgartirish, xatolar', async () => {
  const { db, repo } = await mk();
  try {
    await seedBase(repo, testConfig());
    assert.match(await runUserAdmin(repo, ['set-password', 'U001', 'YangiParol123']), /yangilandi/);
    assert.equal(verifyPassword('YangiParol123', (await repo.userByCode('U001')).password_hash), true);
    assert.match(await runUserAdmin(repo, ['set-role', 'U001', 'operator']), /operator/);
    assert.equal((await repo.userByCode('U001')).role, 'operator');
    await assert.rejects(() => runUserAdmin(repo, ['set-password', 'U001', 'qisqa']), /8 belgi/);
    await assert.rejects(() => runUserAdmin(repo, ['set-role', 'U001', 'god']), /Rol/);
    await assert.rejects(() => runUserAdmin(repo, ['set-role', 'YOQ', 'user']), /topilmadi/);
    await assert.rejects(() => runUserAdmin(repo, ['nomaʼlum', 'U001']), /Buyruq/);
    await assert.rejects(() => runUserAdmin(repo, []), /topilmadi/);
  } finally { await db.close(); }
});
