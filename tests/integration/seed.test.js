import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db.js';
import { createRepo } from '../../src/repo.js';
import { seedBase, seedDemo, USERS } from '../../src/seed.js';
import { verifyPassword } from '../../src/auth.js';
import { runUserAdmin } from '../../scripts/user-admin.js';
import { testConfig } from '../helpers.js';

const mk = () => { const db = openDb(':memory:'); return { db, repo: createRepo(db) }; };

test('seedBase: tashkilot va xodimlar bir marta yaratiladi (idempotent), parollar heshlangan', () => {
  const { repo } = mk();
  const cfg = testConfig();
  seedBase(repo, cfg);
  seedBase(repo, cfg);
  assert.equal(repo.countOrgs(), 4);
  assert.equal(repo.countUsers(), USERS.length);
  const admin = repo.userByCode('admin');
  assert.notEqual(admin.password_hash, cfg.adminPassword);
  assert.equal(verifyPassword(cfg.adminPassword, admin.password_hash), true);
  assert.equal(verifyPassword(cfg.demoPassword, repo.userByCode('U001').password_hash), true);
});

test('seedBase: DEMO_PASSWORD yo‘q bo‘lsa oddiy xodimlar kira olmaydi; admin parolsiz bo‘lsa env’dan o‘rnatiladi', () => {
  const { repo, db } = mk();
  seedBase(repo, { ...testConfig(), demoPassword: '' });
  assert.equal(repo.userByCode('U001').password_hash, null);
  db.prepare("UPDATE users SET password_hash = NULL WHERE code = 'admin'").run();
  seedBase(repo, testConfig());
  assert.ok(repo.userByCode('admin').password_hash);
});

test('seedDemo: deterministik, qayta ishlatilganda yangi hujjat qo‘shmaydi', () => {
  const run = () => { const { db, repo } = mk(); seedBase(repo, testConfig()); const n = seedDemo(db, repo, { today: '2026-11-07' }); return { n, repo, db }; };
  const a = run();
  const b = run();
  assert.ok(a.n > 100);
  assert.equal(a.n, b.n);
  assert.deepEqual(a.repo.findDocs().map((d) => d.number), b.repo.findDocs().map((d) => d.number));
  assert.equal(seedDemo(a.db, a.repo, { today: '2026-11-07' }), 0);
});

test('seedDemo: ma‘lumot butunligi (kelajakdagi sana yo‘q, imzolar va bajarilishlar mantiqiy)', () => {
  const { db, repo } = mk();
  seedBase(repo, testConfig());
  seedDemo(db, repo, { today: '2026-11-07' });
  const docs = repo.findDocs();
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
});

test('user-admin CLI: parol va rolni o‘zgartirish, xatolar', () => {
  const { repo } = mk();
  seedBase(repo, testConfig());
  assert.match(runUserAdmin(repo, ['set-password', 'U001', 'YangiParol123']), /yangilandi/);
  assert.equal(verifyPassword('YangiParol123', repo.userByCode('U001').password_hash), true);
  assert.match(runUserAdmin(repo, ['set-role', 'U001', 'operator']), /operator/);
  assert.equal(repo.userByCode('U001').role, 'operator');
  assert.throws(() => runUserAdmin(repo, ['set-password', 'U001', 'qisqa']), /8 belgi/);
  assert.throws(() => runUserAdmin(repo, ['set-role', 'U001', 'god']), /Rol/);
  assert.throws(() => runUserAdmin(repo, ['set-role', 'YOQ', 'user']), /topilmadi/);
  assert.throws(() => runUserAdmin(repo, ['nomaʼlum', 'U001']), /Buyruq/);
  assert.throws(() => runUserAdmin(repo, []), /topilmadi/);
});
