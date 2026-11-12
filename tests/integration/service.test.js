import test from 'node:test';
import assert from 'node:assert/strict';
import { id, newDoc, setupRoles, startTestApp } from '../helpers.js';

async function env() {
  const t = await startTestApp();
  await setupRoles(t);
  const svc = t.app.svc;
  const ctx = async (code) => ({ user: await t.repo.userByCode(code), ip: '10.0.0.1' });
  return { t, svc, ctx, admin: await ctx('admin'), close: () => t.close() };
}
const code = async (fn) => { try { await fn(); } catch (e) { return `${e.status}:${e.code}`; } return null; };

test('holatlar soat bo‘yicha o‘zgaradi: jarayonda → muddatdan oshdi; vaqtida/kech bajarilgan', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc({ deadline: '2026-11-10', assignee: id(t, 'U001'), signers: [id(t, 'U001')] }));
    assert.equal(d.tasks[0].status, 'prog');
    assert.equal(d.tasks[0].assignees[0].status, 'prog');
    assert.equal(d.status, 'signing');

    t.clock.t = new Date('2026-11-11T08:00:00Z'); // muddat o‘tdi
    const late = await svc.getDocument(admin.user, d.id);
    assert.equal(late.tasks[0].status, 'late');

    const aid = d.tasks[0].assignees[0].id;
    const u1Ctx = await ctx('U001');
    await svc.setDone(u1Ctx, aid, '2026-11-09'); // muddatdan oldin bajarilgan
    assert.equal((await svc.getDocument(admin.user, d.id)).tasks[0].status, 'ok');
    await svc.setDone(u1Ctx, aid, '2026-11-11'); // muddatdan keyin
    assert.equal((await svc.getDocument(admin.user, d.id)).tasks[0].status, 'late');
    await svc.setDone(u1Ctx, aid, null); // bekor qilish
    assert.equal((await svc.getDocument(admin.user, d.id)).tasks[0].assignees[0].done_date, null);

    await svc.sign(u1Ctx, d.id);
    assert.equal((await svc.getDocument(admin.user, d.id)).status, 'signed');
    await svc.send(admin, d.id, 2);
    assert.equal((await svc.getDocument(admin.user, d.id)).status, 'sent');
  } finally { await close(); }
});

test('"bugun" Toshkent vaqti bo‘yicha: UTC 20:30 da Toshkentda keyingi kun', async () => {
  const { t, svc, admin, close } = await env();
  try {
    t.clock.t = new Date('2026-11-07T20:30:00Z');
    assert.equal(svc.today(), '2026-11-08');
    const d = await svc.createDocument(admin, newDoc({ deadline: '2026-11-08' }));
    assert.equal(d.created_at, '2026-11-08');
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ deadline: '2026-11-07' }))), '422:validation_error'); // kecha
  } finally { await close(); }
});

test('createDocument qoidalari: muddat, tashkilot, dublikat, imzolovchi, bajaruvchi roli', async () => {
  const { t, svc, admin, close } = await env();
  try {
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ deadline: '2026-11-06' }))), '422:validation_error');
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ org_id: 999 }))), '422:validation_error');
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ signers: [999] }))), '422:validation_error');
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ assignee: 999 }))), '422:validation_error');
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ assignee: id(t, 'admin') }))), '422:validation_error'); // admin bajaruvchi bo‘la olmaydi
    await t.repo.setRole(id(t, 'U004'), 'user');
    await t.db.run("UPDATE users SET active = 0 WHERE code = 'U004'");
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ assignee: id(t, 'U004') }))), '422:validation_error'); // faol emas
    await svc.createDocument(admin, newDoc({ number: 'DUP-1' }));
    assert.equal(await code(() => svc.createDocument(admin, newDoc({ number: 'DUP-1' }))), '409:conflict');
    // xato bo‘lganda yarim hujjat qolmasligi kerak
    assert.equal(await t.repo.countDocs(), 1);
  } finally { await close(); }
});

test('imzolovchilar takrorlanmaydi va tartib raqami saqlanadi; bajaruvchiga SMS navbatga tushadi', async () => {
  const { t, svc, admin, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc({ number: 'S-1', signers: [id(t, 'U004'), id(t, 'U001'), id(t, 'U004')], assignee: id(t, 'U001') }));
    assert.deepEqual(d.signatures.map((s) => [s.user_id, s.ord]), [[id(t, 'U004'), 1], [id(t, 'U001'), 2]]);
    const sms = await t.repo.listSms();
    assert.equal(sms.length, 1);
    assert.match(sms[0].text, /S-1 nazorat varaqasi sizga biriktirildi/);
    assert.equal(sms[0].status, 'navbatda');
  } finally { await close(); }
});

test('sign: faqat o‘z imzosi, ikki marta imzolab bo‘lmaydi', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc({ signers: [id(t, 'U001')], assignee: id(t, 'U004') }));
    const u1Ctx = await ctx('U001');
    const u4Ctx = await ctx('U004');
    assert.equal(await code(() => svc.sign(u4Ctx, d.id)), '403:forbidden'); // imzolovchi emas
    assert.equal(await code(() => svc.sign(admin, d.id)), '403:forbidden');
    assert.equal((await svc.sign(u1Ctx, d.id)).signatures[0].signed_at, '2026-11-07');
    assert.equal(await code(() => svc.sign(u1Ctx, d.id)), '403:forbidden'); // allaqachon imzolagan
    assert.equal(await code(() => svc.sign(u1Ctx, 9999)), '404:not_found');
  } finally { await close(); }
});

test('send: o‘z tashkilotiga, mavjud bo‘lmagan tashkilotga va takroran yuborib bo‘lmaydi', async () => {
  const { svc, admin, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc({ org_id: 1 }));
    assert.equal(await code(() => svc.send(admin, d.id, 1)), '422:validation_error');
    assert.equal(await code(() => svc.send(admin, d.id, 99)), '422:validation_error');
    assert.equal((await svc.send(admin, d.id, 2)).transfers.length, 1);
    assert.equal(await code(() => svc.send(admin, d.id, 2)), '409:conflict');
    assert.equal((await svc.send(admin, d.id, 3)).transfers.length, 2);
    assert.equal(await code(() => svc.send(admin, 9999, 2)), '404:not_found');
  } finally { await close(); }
});

test('assign: dublikat, noto‘g‘ri xodim, mavjud bo‘lmagan topshiriq', async () => {
  const { t, svc, admin, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc());
    const taskId = d.tasks[0].id;
    const a = await svc.assign(admin, taskId, id(t, 'U001'));
    assert.equal(a.done_date, null);
    assert.equal(await code(() => svc.assign(admin, taskId, id(t, 'U001'))), '409:conflict');
    assert.equal(await code(() => svc.assign(admin, taskId, 999)), '422:validation_error');
    assert.equal(await code(() => svc.assign(admin, 9999, id(t, 'U001'))), '404:not_found');
    assert.equal((await t.repo.listSms()).length, 1);
  } finally { await close(); }
});

test('setDone: hujjatdan oldingi va kelajak sanasi rad etiladi, begona topshiriqni belgilab bo‘lmaydi', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc({ assignee: id(t, 'U001') }));
    const aid = d.tasks[0].assignees[0].id;
    const u1Ctx = await ctx('U001');
    const u4Ctx = await ctx('U004');
    const u3Ctx = await ctx('U003');
    const u2Ctx = await ctx('U002');
    assert.equal(await code(() => svc.setDone(u1Ctx, aid, '2026-11-06')), '422:validation_error');
    assert.equal(await code(() => svc.setDone(u1Ctx, aid, '2026-11-08')), '422:validation_error');
    assert.equal(await code(() => svc.setDone(u4Ctx, aid, '2026-11-07')), '403:forbidden');
    assert.equal(await code(() => svc.setDone(u3Ctx, aid, '2026-11-07')), '403:forbidden'); // viewer
    assert.equal(await code(() => svc.setDone(admin, 9999, null)), '404:not_found');
    assert.equal(await code(() => svc.setDone(admin, aid, '2026-11-07')), '403:forbidden'); // admin o'zgartira olmaydi
    assert.equal(await code(() => svc.setDone(u2Ctx, aid, '2026-11-07')), '403:forbidden'); // operator ham o'zgartira olmaydi
    assert.equal((await svc.setDone(u1Ctx, aid, '2026-11-07')).done_date, '2026-11-07'); // faqat bajaruvchi xodimning o'zi
  } finally { await close(); }
});

test('updateDocument/deleteDocument qoidalari', async () => {
  const { svc, ctx, admin, close } = await env();
  try {
    const a = await svc.createDocument(admin, newDoc({ number: 'U-1' }));
    const b = await svc.createDocument(admin, newDoc({ number: 'U-2' }));
    const u2Ctx = await ctx('U002');
    assert.equal((await svc.updateDocument(u2Ctx, a.id, { title: 'Yangi', org_id: 2 })).title, 'Yangi');
    assert.equal(await code(() => svc.updateDocument(admin, a.id, {})), '422:validation_error');
    assert.equal(await code(() => svc.updateDocument(admin, a.id, { number: 'U-2' })), '409:conflict');
    assert.equal((await svc.updateDocument(admin, a.id, { number: 'U-1' })).number, 'U-1'); // o‘z raqamiga o‘zgartirish — xato emas
    assert.equal(await code(() => svc.updateDocument(admin, a.id, { org_id: 99 })), '422:validation_error');
    assert.equal(await code(() => svc.updateDocument(admin, 9999, { title: 'x' })), '404:not_found');
    assert.equal(await code(() => svc.deleteDocument(u2Ctx, b.id)), '403:forbidden'); // operator o‘chira olmaydi
    await svc.deleteDocument(admin, b.id);
    assert.equal(await code(() => svc.getDocument(admin.user, b.id)), '404:not_found');
    assert.equal(await code(() => svc.deleteDocument(admin, b.id)), '404:not_found');
  } finally { await close(); }
});

test('ko‘rinish: oddiy xodim faqat o‘z hujjatlarini/topshiriqlarini ko‘radi, viewer hammasini (faqat o‘qish)', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const mine = await svc.createDocument(admin, newDoc({ number: 'M-1', assignee: id(t, 'U001') }));
    await svc.createDocument(admin, newDoc({ number: 'M-2', assignee: id(t, 'U004') }));
    const u1 = (await ctx('U001')).user;
    const u2 = (await ctx('U002')).user;
    const u3 = (await ctx('U003')).user;
    assert.deepEqual((await svc.listDocuments(u1, { page: 1, per_page: 20 })).data.map((d) => d.number), ['M-1']);
    assert.equal((await svc.listDocuments(u3, { page: 1, per_page: 20 })).meta.total, 2); // viewer
    assert.equal(await code(() => svc.getDocument(u1, mine.id + 1)), '404:not_found'); // begona hujjat — mavjudligi ham bildirilmaydi
    assert.deepEqual((await svc.listTasks(u1, { page: 1, per_page: 20 })).data.map((x) => x.doc_number), ['M-1']);
    assert.equal((await svc.stats(u1, {})).total, 1);
    assert.equal((await svc.stats(admin.user, {})).total, 2);
    assert.equal(await code(() => svc.listSms(u1)), '403:forbidden');
    assert.equal(await code(() => svc.listSms(u3)), '403:forbidden');
    assert.equal((await svc.listSms(u2)).length, 2);
  } finally { await close(); }
});

test('hujjatlar ro‘yxati filtrlari: holat, hujjat holati, sana oralig‘i va sahifalash', async () => {
  const { t, svc, admin, close } = await env();
  try {
    await svc.createDocument(admin, newDoc({ number: 'F-1', deadline: '2026-11-09' })); // new (bajaruvchisiz)
    await svc.createDocument(admin, newDoc({ number: 'F-2', deadline: '2026-11-09', assignee: id(t, 'U001') })); // prog
    await svc.createDocument(admin, newDoc({ number: 'F-3', deadline: '2026-11-09', signers: [id(t, 'U001')] }));
    const L = async (f) => (await svc.listDocuments(admin.user, { page: 1, per_page: 20, ...f })).data.map((d) => d.number).sort();
    assert.deepEqual(await L({ status: 'new' }), ['F-1', 'F-3']);
    assert.deepEqual(await L({ status: 'prog' }), ['F-2']);
    assert.deepEqual(await L({ doc_status: 'signing' }), ['F-3']);
    assert.deepEqual(await L({ date_from: '2026-11-08' }), []);
    assert.equal(await code(() => svc.listDocuments(admin.user, { page: 1, per_page: 20, date_from: '2026-12-01', date_to: '2026-01-01' })), '422:validation_error');
    const p2 = await svc.listDocuments(admin.user, { page: 2, per_page: 2 });
    assert.equal(p2.data.length, 1);
    assert.deepEqual(p2.meta, { page: 2, per_page: 2, total: 3, total_pages: 2 });
    assert.equal((await svc.listDocuments(admin.user, { page: 9, per_page: 2 })).data.length, 0);
  } finally { await close(); }
});

test('topshiriqlar va statistika: davr filtri (yil/oy)', async () => {
  const { t, svc, admin, close } = await env();
  try {
    await svc.createDocument(admin, newDoc({ assignee: id(t, 'U001') }));
    t.clock.t = new Date('2026-12-15T08:00:00Z');
    await svc.createDocument(admin, newDoc({ deadline: '2026-12-30' }));
    const L = async (f) => (await svc.listTasks(admin.user, { page: 1, per_page: 20, ...f })).meta.total;
    assert.equal(await L({}), 2);
    assert.equal(await L({ year: 2026, month: 11 }), 1);
    assert.equal(await L({ year: 2026, month: 12 }), 1);
    assert.equal(await L({ year: 2025 }), 0);
    assert.equal(await L({ status: 'new' }), 1);
    assert.equal(await code(() => svc.listTasks(admin.user, { page: 1, per_page: 20, month: 3 })), '422:validation_error');
    assert.equal(await code(() => svc.stats(admin.user, { month: 3 })), '422:validation_error');
    const s = await svc.stats(admin.user, { year: 2026, month: 12 });
    assert.deepEqual({ total: s.total, new: s.new, month: s.month, year: s.year }, { total: 1, new: 1, month: 12, year: 2026 });
    assert.equal((await svc.stats(admin.user, {})).year, 2026); // yil berilmasa — joriy yil
  } finally { await close(); }
});

test('login: faol bo‘lmagan, parolsiz va noto‘g‘ri parol bir xil xato; audit yoziladi, parol yozilmaydi', async () => {
  const { t, svc, close } = await env();
  try {
    const ctx = { user: null, ip: '9.9.9.9' };
    await t.db.run("UPDATE users SET active = 0 WHERE code = 'U005'");
    await t.db.run("UPDATE users SET password_hash = NULL WHERE code = 'U006'");
    const bad = [{ id: 'U005', password: 'demopass1' }, { id: 'U006', password: 'demopass1' }, { id: 'admin', password: 'xato' }, { id: 'YOQ', password: 'x' }];
    for (const b of bad) {
      assert.equal(await code(() => svc.login(ctx, b)), '401:invalid_credentials', b.id);
    }
    const ok = await svc.login(ctx, { id: 'admin', password: 'adminpass1' });
    assert.equal(ok.user.role, 'admin');
    assert.ok(!('password_hash' in ok.user));
    const { rows } = await t.repo.listAudit({ limit: 50, offset: 0 });
    assert.equal(rows.filter((r) => r.action === 'login_failed').length, 4);
    assert.equal(rows.filter((r) => r.action === 'login').length, 1);
    assert.ok(!JSON.stringify(rows).includes('xato"') && !JSON.stringify(rows).includes('adminpass1'));
  } finally { await close(); }
});

test('audit: o‘zgartiruvchi amallar yoziladi (kim, nima, IP)', async () => {
  const { t, svc, admin, close } = await env();
  try {
    const d = await svc.createDocument(admin, newDoc({ number: 'AU-1' }));
    await svc.send(admin, d.id, 2);
    await svc.deleteDocument(admin, d.id);
    const actions = (await t.repo.listAudit({ limit: 10, offset: 0 })).rows.map((r) => r.action);
    assert.deepEqual(actions, ['document_delete', 'document_send', 'document_create']);
    const row = (await t.repo.listAudit({ limit: 1, offset: 0 })).rows[0];
    assert.equal(row.user_id, admin.user.id);
    assert.equal(row.ip, '10.0.0.1');
    assert.deepEqual(row.details, { number: 'AU-1' });
  } finally { await close(); }
});
