import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db.js';
import { createRepo } from '../../src/repo.js';

async function env() {
  const db = await openDb(':memory:');
  const repo = createRepo(db);
  const o1 = await repo.insertOrg('Birinchi');
  const o2 = await repo.insertOrg('Ikkinchi');
  const admin = await repo.insertUser({ name: 'Admin', org_id: o1, role: 'admin', code: 'admin' });
  const u1 = await repo.insertUser({ name: 'Bir', org_id: o1, role: 'user', code: 'U1' });
  const u2 = await repo.insertUser({ name: 'Ikki', org_id: o1, role: 'user', code: 'U2' });
  const u3 = await repo.insertUser({ name: 'Uch', org_id: o2, role: 'user', code: 'U3' });
  const mk = (number, over = {}) => repo.insertDoc({ number, type: 'Xat', title: `Mazmun ${number}`, org_id: o1, created_by: admin, created_at: '2026-05-01', ...over });
  return { db, repo, o1, o2, admin, u1, u2, u3, mk };
}

test('hujjat to‘liq (topshiriq, bajaruvchi, imzo, almashinuv) bilan yig‘iladi', async () => {
  const { db, repo, o1, o2, admin, u1, u2, mk } = await env();
  try {
    const d = await mk('A-1');
    const t = await repo.insertTask({ doc_id: d, title: 'T', issued_by: admin, deadline: '2026-06-01' });
    await repo.insertAssignee({ task_id: t, user_id: u1, assigned_by: admin, assigned_at: '2026-05-01' });
    await repo.insertSignature({ doc_id: d, user_id: u2, ord: 2 });
    await repo.insertSignature({ doc_id: d, user_id: u1, ord: 1 });
    await repo.insertTransfer({ doc_id: d, from_org: o1, to_org: o2, sent_at: '2026-05-02' });
    const doc = await repo.docById(d);
    assert.equal(doc.tasks.length, 1);
    assert.equal(doc.tasks[0].assignees[0].user_id, u1);
    assert.deepEqual(doc.signatures.map((s) => s.ord), [1, 2]); // ord bo‘yicha tartiblangan
    assert.equal(doc.transfers[0].to_org, o2);
    assert.equal(Object.getPrototypeOf(doc), Object.prototype); // oddiy obyekt (null-prototype emas)
    assert.equal(await repo.docById(9999), null);
  } finally { await db.close(); }
});

test('findDocs: tartib (yangi birinchi), qidiruv, tashkilot va sana filtrlari', async () => {
  const { db, repo, o2, mk } = await env();
  try {
    await mk('B-1', { created_at: '2026-01-10' });
    await mk('B-2', { created_at: '2026-03-10', org_id: o2, title: 'Maxsus hisobot' });
    await mk('B-3', { created_at: '2026-03-10' });
    assert.deepEqual((await repo.findDocs()).map((d) => d.number), ['B-3', 'B-2', 'B-1']);
    assert.deepEqual((await repo.findDocs({ q: 'maxsus' })).map((d) => d.number), ['B-2']); // katta-kichik harf farqsiz
    assert.deepEqual((await repo.findDocs({ org_id: o2 })).map((d) => d.number), ['B-2']);
    assert.deepEqual((await repo.findDocs({ date_from: '2026-02-01' })).map((d) => d.number), ['B-3', 'B-2']);
    assert.deepEqual((await repo.findDocs({ date_to: '2026-02-01' })).map((d) => d.number), ['B-1']);
  } finally { await db.close(); }
});

test('findDocs: LIKE maxsus belgilari (%, _) oddiy matn sifatida qidiriladi', async () => {
  const { db, repo, mk } = await env();
  try {
    await mk('C-1', { title: '100% tayyor' });
    await mk('C-2', { title: 'oddiy' });
    assert.deepEqual((await repo.findDocs({ q: '%' })).map((d) => d.number), ['C-1']);
    assert.deepEqual((await repo.findDocs({ q: '_' })).map((d) => d.number), []);
  } finally { await db.close(); }
});

test('findDocs: qidiruvdagi SQL-inyeksiya urinishi zarar yetkazmaydi', async () => {
  const { db, repo, mk } = await env();
  try {
    await mk('D-1');
    assert.deepEqual(await repo.findDocs({ q: "x'; DROP TABLE documents; --" }), []);
    assert.equal((await repo.findDocs()).length, 1);
  } finally { await db.close(); }
});

test('findDocs: oddiy xodim faqat o‘ziga tegishli hujjatlarni ko‘radi (yaratuvchi/imzolovchi/bajaruvchi)', async () => {
  const { db, repo, admin, u1, u2, u3, mk } = await env();
  try {
    const bySigner = await mk('E-1');
    await repo.insertSignature({ doc_id: bySigner, user_id: u1, ord: 1 });
    const byAssignee = await mk('E-2');
    const t = await repo.insertTask({ doc_id: byAssignee, title: 'T', issued_by: admin, deadline: '2026-06-01' });
    await repo.insertAssignee({ task_id: t, user_id: u1, assigned_by: admin, assigned_at: '2026-05-01' });
    await mk('E-3'); // u1 ga aloqasiz
    const byCreator = await mk('E-4', { created_by: u1 });
    const nums = async (u) => (await repo.findDocs({ user: { id: u } })).map((d) => d.number).sort();
    assert.deepEqual(await nums(u1), ['E-1', 'E-2', 'E-4']);
    assert.deepEqual(await nums(u2), []);
    assert.deepEqual(await nums(u3), []);
    assert.ok(byCreator);
  } finally { await db.close(); }
});

test('hydrate: 500 dan ko‘p hujjat bo‘laklab yuklanadi (SQLite parametr chegarasi)', async () => {
  const { repo, admin, db, mk } = await env();
  try {
    await db.exec('BEGIN');
    for (let i = 0; i < 1200; i += 1) {
      const d = await mk(`BULK-${i}`);
      await repo.insertTask({ doc_id: d, title: 'T', issued_by: admin, deadline: '2026-06-01' });
    }
    await db.exec('COMMIT');
    const all = await repo.findDocs();
    assert.equal(all.length, 1200);
    assert.ok(all.every((d) => d.tasks.length === 1));
  } finally { await db.close(); }
});

test('yozuvlar: imzo, bajarilish, tahrir, o‘chirish, SMS va audit', async () => {
  const { db, repo, admin, u1, mk } = await env();
  try {
    const d = await mk('F-1');
    const sig = await repo.insertSignature({ doc_id: d, user_id: u1, ord: 1 });
    assert.ok(await repo.pendingSignature(d, u1));
    await repo.sign(sig, '2026-05-02');
    assert.equal(await repo.pendingSignature(d, u1), null);

    const t = await repo.insertTask({ doc_id: d, title: 'T', issued_by: admin, deadline: '2026-06-01' });
    const a = await repo.insertAssignee({ task_id: t, user_id: u1, assigned_by: admin, assigned_at: '2026-05-01' });
    assert.equal(await repo.assigneeExists(t, u1), true);
    assert.equal(await repo.assigneeExists(t, admin), false);
    await repo.setDone(a, '2026-05-10');
    assert.equal((await repo.assigneeById(a)).done_date, '2026-05-10');
    assert.equal((await repo.assigneeById(a)).doc_created_at, '2026-05-01');

    assert.equal(await repo.updateDoc(d, {}), 0);
    assert.equal(await repo.updateDoc(d, { title: 'Yangi' }), 1);
    assert.equal((await repo.docById(d)).title, 'Yangi');

    await repo.enqueueSms({ to: 'Bir', text: 'xabar', at: '2026-05-01' });
    assert.deepEqual(await repo.listSms(), [{ to: 'Bir', text: 'xabar', at: '2026-05-01', status: 'navbatda' }]);

    for (let i = 0; i < 5; i += 1) await repo.insertAudit({ at: `2026-05-0${i + 1}`, user_id: admin, action: `a${i}`, details: { i } });
    const page = await repo.listAudit({ limit: 2, offset: 1 });
    assert.equal(page.total, 5);
    assert.deepEqual(page.rows.map((r) => r.action), ['a3', 'a2']);
    assert.deepEqual(page.rows[0].details, { i: 3 });

    assert.equal(await repo.deleteDoc(d), 1);
    assert.equal(await repo.docById(d), null);
    assert.equal(await repo.ping(), true);
  } finally { await db.close(); }
});

test('foydalanuvchi va tashkilot so‘rovlari', async () => {
  const { db, repo, u1, o1 } = await env();
  try {
    assert.equal((await repo.userByCode('U1')).id, u1);
    assert.equal(await repo.userByCode('yo‘q'), null);
    assert.equal((await repo.userById(u1)).code, 'U1');
    const users = await repo.listUsers();
    assert.equal(users.length, 4);
    assert.ok(!('password_hash' in users[0])); // ro‘yxatda parol hesh yo‘q
    assert.equal((await repo.orgById(o1)).name, 'Birinchi');
    assert.equal(await repo.countUsers(), 4);
    assert.equal(await repo.countOrgs(), 2);
    assert.equal(await repo.setRole(u1, 'viewer'), 1);
    assert.equal((await repo.userById(u1)).role, 'viewer');
  } finally { await db.close(); }
});
