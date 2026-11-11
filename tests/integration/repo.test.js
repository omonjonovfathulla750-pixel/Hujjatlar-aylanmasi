import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db.js';
import { createRepo } from '../../src/repo.js';

function env() {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const o1 = repo.insertOrg('Birinchi');
  const o2 = repo.insertOrg('Ikkinchi');
  const admin = repo.insertUser({ name: 'Admin', org_id: o1, role: 'admin', code: 'admin' });
  const u1 = repo.insertUser({ name: 'Bir', org_id: o1, role: 'user', code: 'U1' });
  const u2 = repo.insertUser({ name: 'Ikki', org_id: o1, role: 'user', code: 'U2' });
  const u3 = repo.insertUser({ name: 'Uch', org_id: o2, role: 'user', code: 'U3' });
  const mk = (number, over = {}) => repo.insertDoc({ number, type: 'Xat', title: `Mazmun ${number}`, org_id: o1, created_by: admin, created_at: '2026-05-01', ...over });
  return { db, repo, o1, o2, admin, u1, u2, u3, mk };
}

test('hujjat to‘liq (topshiriq, bajaruvchi, imzo, almashinuv) bilan yig‘iladi', () => {
  const { repo, o1, o2, admin, u1, u2, mk } = env();
  const d = mk('A-1');
  const t = repo.insertTask({ doc_id: d, title: 'T', issued_by: admin, deadline: '2026-06-01' });
  repo.insertAssignee({ task_id: t, user_id: u1, assigned_by: admin, assigned_at: '2026-05-01' });
  repo.insertSignature({ doc_id: d, user_id: u2, ord: 2 });
  repo.insertSignature({ doc_id: d, user_id: u1, ord: 1 });
  repo.insertTransfer({ doc_id: d, from_org: o1, to_org: o2, sent_at: '2026-05-02' });
  const doc = repo.docById(d);
  assert.equal(doc.tasks.length, 1);
  assert.equal(doc.tasks[0].assignees[0].user_id, u1);
  assert.deepEqual(doc.signatures.map((s) => s.ord), [1, 2]); // ord bo‘yicha tartiblangan
  assert.equal(doc.transfers[0].to_org, o2);
  assert.equal(Object.getPrototypeOf(doc), Object.prototype); // oddiy obyekt (null-prototype emas)
  assert.equal(repo.docById(9999), null);
});

test('findDocs: tartib (yangi birinchi), qidiruv, tashkilot va sana filtrlari', () => {
  const { repo, o2, mk } = env();
  mk('B-1', { created_at: '2026-01-10' });
  mk('B-2', { created_at: '2026-03-10', org_id: o2, title: 'Maxsus hisobot' });
  mk('B-3', { created_at: '2026-03-10' });
  assert.deepEqual(repo.findDocs().map((d) => d.number), ['B-3', 'B-2', 'B-1']);
  assert.deepEqual(repo.findDocs({ q: 'maxsus' }).map((d) => d.number), ['B-2']); // katta-kichik harf farqsiz
  assert.deepEqual(repo.findDocs({ org_id: o2 }).map((d) => d.number), ['B-2']);
  assert.deepEqual(repo.findDocs({ date_from: '2026-02-01' }).map((d) => d.number), ['B-3', 'B-2']);
  assert.deepEqual(repo.findDocs({ date_to: '2026-02-01' }).map((d) => d.number), ['B-1']);
});

test('findDocs: LIKE maxsus belgilari (%, _) oddiy matn sifatida qidiriladi', () => {
  const { repo, mk } = env();
  mk('C-1', { title: '100% tayyor' });
  mk('C-2', { title: 'oddiy' });
  assert.deepEqual(repo.findDocs({ q: '%' }).map((d) => d.number), ['C-1']);
  assert.deepEqual(repo.findDocs({ q: '_' }).map((d) => d.number), []);
});

test('findDocs: qidiruvdagi SQL-inyeksiya urinishi zarar yetkazmaydi', () => {
  const { repo, mk } = env();
  mk('D-1');
  assert.deepEqual(repo.findDocs({ q: "x'; DROP TABLE documents; --" }), []);
  assert.equal(repo.findDocs().length, 1);
});

test('findDocs: oddiy xodim faqat o‘ziga tegishli hujjatlarni ko‘radi (yaratuvchi/imzolovchi/bajaruvchi)', () => {
  const { repo, admin, u1, u2, u3, mk } = env();
  const bySigner = mk('E-1');
  repo.insertSignature({ doc_id: bySigner, user_id: u1, ord: 1 });
  const byAssignee = mk('E-2');
  const t = repo.insertTask({ doc_id: byAssignee, title: 'T', issued_by: admin, deadline: '2026-06-01' });
  repo.insertAssignee({ task_id: t, user_id: u1, assigned_by: admin, assigned_at: '2026-05-01' });
  mk('E-3'); // u1 ga aloqasiz
  const byCreator = mk('E-4', { created_by: u1 });
  const nums = (u) => repo.findDocs({ user: { id: u } }).map((d) => d.number).sort();
  assert.deepEqual(nums(u1), ['E-1', 'E-2', 'E-4']);
  assert.deepEqual(nums(u2), []);
  assert.deepEqual(nums(u3), []);
  assert.ok(byCreator);
});

test('hydrate: 500 dan ko‘p hujjat bo‘laklab yuklanadi (SQLite parametr chegarasi)', () => {
  const { repo, admin, db, mk } = env();
  db.exec('BEGIN');
  for (let i = 0; i < 1200; i += 1) {
    const d = mk(`BULK-${i}`);
    repo.insertTask({ doc_id: d, title: 'T', issued_by: admin, deadline: '2026-06-01' });
  }
  db.exec('COMMIT');
  const all = repo.findDocs();
  assert.equal(all.length, 1200);
  assert.ok(all.every((d) => d.tasks.length === 1));
});

test('yozuvlar: imzo, bajarilish, tahrir, o‘chirish, SMS va audit', () => {
  const { repo, admin, u1, mk } = env();
  const d = mk('F-1');
  const sig = repo.insertSignature({ doc_id: d, user_id: u1, ord: 1 });
  assert.ok(repo.pendingSignature(d, u1));
  repo.sign(sig, '2026-05-02');
  assert.equal(repo.pendingSignature(d, u1), null);

  const t = repo.insertTask({ doc_id: d, title: 'T', issued_by: admin, deadline: '2026-06-01' });
  const a = repo.insertAssignee({ task_id: t, user_id: u1, assigned_by: admin, assigned_at: '2026-05-01' });
  assert.equal(repo.assigneeExists(t, u1), true);
  assert.equal(repo.assigneeExists(t, admin), false);
  repo.setDone(a, '2026-05-10');
  assert.equal(repo.assigneeById(a).done_date, '2026-05-10');
  assert.equal(repo.assigneeById(a).doc_created_at, '2026-05-01');

  assert.equal(repo.updateDoc(d, {}), 0);
  assert.equal(repo.updateDoc(d, { title: 'Yangi' }), 1);
  assert.equal(repo.docById(d).title, 'Yangi');

  repo.enqueueSms({ to: 'Bir', text: 'xabar', at: '2026-05-01' });
  assert.deepEqual(repo.listSms(), [{ to: 'Bir', text: 'xabar', at: '2026-05-01', status: 'navbatda' }]);

  for (let i = 0; i < 5; i += 1) repo.insertAudit({ at: `2026-05-0${i + 1}`, user_id: admin, action: `a${i}`, details: { i } });
  const page = repo.listAudit({ limit: 2, offset: 1 });
  assert.equal(page.total, 5);
  assert.deepEqual(page.rows.map((r) => r.action), ['a3', 'a2']);
  assert.deepEqual(page.rows[0].details, { i: 3 });

  assert.equal(repo.deleteDoc(d), 1);
  assert.equal(repo.docById(d), null);
  assert.equal(repo.ping(), true);
});

test('foydalanuvchi va tashkilot so‘rovlari', () => {
  const { repo, u1, o1 } = env();
  assert.equal(repo.userByCode('U1').id, u1);
  assert.equal(repo.userByCode('yo‘q'), null);
  assert.equal(repo.userById(u1).code, 'U1');
  assert.equal(repo.listUsers().length, 4);
  assert.ok(!('password_hash' in repo.listUsers()[0])); // ro‘yxatda parol hesh yo‘q
  assert.equal(repo.orgById(o1).name, 'Birinchi');
  assert.equal(repo.countUsers(), 4);
  assert.equal(repo.countOrgs(), 2);
  assert.equal(repo.setRole(u1, 'viewer'), 1);
  assert.equal(repo.userById(u1).role, 'viewer');
});
