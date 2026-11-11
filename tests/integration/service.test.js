import test from 'node:test';
import assert from 'node:assert/strict';
import { id, newDoc, setupRoles, startTestApp } from '../helpers.js';

async function env() {
  const t = await startTestApp();
  setupRoles(t);
  const svc = t.app.svc;
  const ctx = (code) => ({ user: t.repo.userByCode(code), ip: '10.0.0.1' });
  return { t, svc, ctx, admin: ctx('admin'), close: () => t.close() };
}
const code = (fn) => { try { fn(); } catch (e) { return `${e.status}:${e.code}`; } return null; };

test('holatlar soat bo‘yicha o‘zgaradi: jarayonda → muddatdan oshdi; vaqtida/kech bajarilgan', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc({ deadline: '2026-11-10', assignee: id(t, 'U001'), signers: [id(t, 'U001')] }));
    assert.equal(d.tasks[0].status, 'prog');
    assert.equal(d.tasks[0].assignees[0].status, 'prog');
    assert.equal(d.status, 'signing');

    t.clock.t = new Date('2026-11-11T08:00:00Z'); // muddat o‘tdi
    const late = svc.getDocument(admin.user, d.id);
    assert.equal(late.tasks[0].status, 'late');

    const aid = d.tasks[0].assignees[0].id;
    svc.setDone(ctx('U001'), aid, '2026-11-09'); // muddatdan oldin bajarilgan
    assert.equal(svc.getDocument(admin.user, d.id).tasks[0].status, 'ok');
    svc.setDone(ctx('U001'), aid, '2026-11-11'); // muddatdan keyin
    assert.equal(svc.getDocument(admin.user, d.id).tasks[0].status, 'late');
    svc.setDone(ctx('U001'), aid, null); // bekor qilish
    assert.equal(svc.getDocument(admin.user, d.id).tasks[0].assignees[0].done_date, null);

    svc.sign(ctx('U001'), d.id);
    assert.equal(svc.getDocument(admin.user, d.id).status, 'signed');
    svc.send(admin, d.id, 2);
    assert.equal(svc.getDocument(admin.user, d.id).status, 'sent');
  } finally { await close(); }
});

test('"bugun" Toshkent vaqti bo‘yicha: UTC 20:30 da Toshkentda keyingi kun', async () => {
  const { t, svc, admin, close } = await env();
  try {
    t.clock.t = new Date('2026-11-07T20:30:00Z');
    assert.equal(svc.today(), '2026-11-08');
    const d = svc.createDocument(admin, newDoc({ deadline: '2026-11-08' }));
    assert.equal(d.created_at, '2026-11-08');
    assert.equal(code(() => svc.createDocument(admin, newDoc({ deadline: '2026-11-07' }))), '422:validation_error'); // kecha
  } finally { await close(); }
});

test('createDocument qoidalari: muddat, tashkilot, dublikat, imzolovchi, bajaruvchi roli', async () => {
  const { t, svc, admin, close } = await env();
  try {
    assert.equal(code(() => svc.createDocument(admin, newDoc({ deadline: '2026-11-06' }))), '422:validation_error');
    assert.equal(code(() => svc.createDocument(admin, newDoc({ org_id: 999 }))), '422:validation_error');
    assert.equal(code(() => svc.createDocument(admin, newDoc({ signers: [999] }))), '422:validation_error');
    assert.equal(code(() => svc.createDocument(admin, newDoc({ assignee: 999 }))), '422:validation_error');
    assert.equal(code(() => svc.createDocument(admin, newDoc({ assignee: id(t, 'admin') }))), '422:validation_error'); // admin bajaruvchi bo‘la olmaydi
    t.repo.setRole(id(t, 'U004'), 'user');
    t.db.prepare("UPDATE users SET active = 0 WHERE code = 'U004'").run();
    assert.equal(code(() => svc.createDocument(admin, newDoc({ assignee: id(t, 'U004') }))), '422:validation_error'); // faol emas
    svc.createDocument(admin, newDoc({ number: 'DUP-1' }));
    assert.equal(code(() => svc.createDocument(admin, newDoc({ number: 'DUP-1' }))), '409:conflict');
    // xato bo‘lganda yarim hujjat qolmasligi kerak
    assert.equal(t.repo.countDocs(), 1);
  } finally { await close(); }
});

test('imzolovchilar takrorlanmaydi va tartib raqami saqlanadi; bajaruvchiga SMS navbatga tushadi', async () => {
  const { t, svc, admin, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc({ number: 'S-1', signers: [id(t, 'U004'), id(t, 'U001'), id(t, 'U004')], assignee: id(t, 'U001') }));
    assert.deepEqual(d.signatures.map((s) => [s.user_id, s.ord]), [[id(t, 'U004'), 1], [id(t, 'U001'), 2]]);
    const sms = t.repo.listSms();
    assert.equal(sms.length, 1);
    assert.match(sms[0].text, /S-1 nazorat varaqasi sizga biriktirildi/);
    assert.equal(sms[0].status, 'navbatda');
  } finally { await close(); }
});

test('sign: faqat o‘z imzosi, ikki marta imzolab bo‘lmaydi', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc({ signers: [id(t, 'U001')], assignee: id(t, 'U004') }));
    assert.equal(code(() => svc.sign(ctx('U004'), d.id)), '403:forbidden'); // imzolovchi emas
    assert.equal(code(() => svc.sign(admin, d.id)), '403:forbidden');
    assert.equal(svc.sign(ctx('U001'), d.id).signatures[0].signed_at, '2026-11-07');
    assert.equal(code(() => svc.sign(ctx('U001'), d.id)), '403:forbidden'); // allaqachon imzolagan
    assert.equal(code(() => svc.sign(ctx('U001'), 9999)), '404:not_found');
  } finally { await close(); }
});

test('send: o‘z tashkilotiga, mavjud bo‘lmagan tashkilotga va takroran yuborib bo‘lmaydi', async () => {
  const { svc, admin, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc({ org_id: 1 }));
    assert.equal(code(() => svc.send(admin, d.id, 1)), '422:validation_error');
    assert.equal(code(() => svc.send(admin, d.id, 99)), '422:validation_error');
    assert.equal(svc.send(admin, d.id, 2).transfers.length, 1);
    assert.equal(code(() => svc.send(admin, d.id, 2)), '409:conflict');
    assert.equal(svc.send(admin, d.id, 3).transfers.length, 2);
    assert.equal(code(() => svc.send(admin, 9999, 2)), '404:not_found');
  } finally { await close(); }
});

test('assign: dublikat, noto‘g‘ri xodim, mavjud bo‘lmagan topshiriq', async () => {
  const { t, svc, admin, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc());
    const taskId = d.tasks[0].id;
    const a = svc.assign(admin, taskId, id(t, 'U001'));
    assert.equal(a.done_date, null);
    assert.equal(code(() => svc.assign(admin, taskId, id(t, 'U001'))), '409:conflict');
    assert.equal(code(() => svc.assign(admin, taskId, 999)), '422:validation_error');
    assert.equal(code(() => svc.assign(admin, 9999, id(t, 'U001'))), '404:not_found');
    assert.equal(t.repo.listSms().length, 1);
  } finally { await close(); }
});

test('setDone: hujjatdan oldingi va kelajak sanasi rad etiladi, begona topshiriqni belgilab bo‘lmaydi', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc({ assignee: id(t, 'U001') }));
    const aid = d.tasks[0].assignees[0].id;
    assert.equal(code(() => svc.setDone(ctx('U001'), aid, '2026-11-06')), '422:validation_error');
    assert.equal(code(() => svc.setDone(ctx('U001'), aid, '2026-11-08')), '422:validation_error');
    assert.equal(code(() => svc.setDone(ctx('U004'), aid, '2026-11-07')), '403:forbidden');
    assert.equal(code(() => svc.setDone(ctx('U003'), aid, '2026-11-07')), '403:forbidden'); // viewer
    assert.equal(code(() => svc.setDone(admin, 9999, null)), '404:not_found');
    assert.equal(code(() => svc.setDone(admin, aid, '2026-11-07')), '403:forbidden'); // admin o'zgartira olmaydi
    assert.equal(code(() => svc.setDone(ctx('U002'), aid, '2026-11-07')), '403:forbidden'); // operator ham o'zgartira olmaydi
    assert.equal(svc.setDone(ctx('U001'), aid, '2026-11-07').done_date, '2026-11-07'); // faqat bajaruvchi xodimning o'zi
  } finally { await close(); }
});

test('updateDocument/deleteDocument qoidalari', async () => {
  const { svc, ctx, admin, close } = await env();
  try {
    const a = svc.createDocument(admin, newDoc({ number: 'U-1' }));
    const b = svc.createDocument(admin, newDoc({ number: 'U-2' }));
    assert.equal(svc.updateDocument(ctx('U002'), a.id, { title: 'Yangi', org_id: 2 }).title, 'Yangi');
    assert.equal(code(() => svc.updateDocument(admin, a.id, {})), '422:validation_error');
    assert.equal(code(() => svc.updateDocument(admin, a.id, { number: 'U-2' })), '409:conflict');
    assert.equal(svc.updateDocument(admin, a.id, { number: 'U-1' }).number, 'U-1'); // o‘z raqamiga o‘zgartirish — xato emas
    assert.equal(code(() => svc.updateDocument(admin, a.id, { org_id: 99 })), '422:validation_error');
    assert.equal(code(() => svc.updateDocument(admin, 9999, { title: 'x' })), '404:not_found');
    assert.equal(code(() => svc.deleteDocument(ctx('U002'), b.id)), '403:forbidden'); // operator o‘chira olmaydi
    svc.deleteDocument(admin, b.id);
    assert.equal(code(() => svc.getDocument(admin.user, b.id)), '404:not_found');
    assert.equal(code(() => svc.deleteDocument(admin, b.id)), '404:not_found');
  } finally { await close(); }
});

test('ko‘rinish: oddiy xodim faqat o‘z hujjatlarini/topshiriqlarini ko‘radi, viewer hammasini (faqat o‘qish)', async () => {
  const { t, svc, admin, ctx, close } = await env();
  try {
    const mine = svc.createDocument(admin, newDoc({ number: 'M-1', assignee: id(t, 'U001') }));
    svc.createDocument(admin, newDoc({ number: 'M-2', assignee: id(t, 'U004') }));
    const u1 = ctx('U001').user;
    assert.deepEqual(svc.listDocuments(u1, { page: 1, per_page: 20 }).data.map((d) => d.number), ['M-1']);
    assert.equal(svc.listDocuments(ctx('U003').user, { page: 1, per_page: 20 }).meta.total, 2); // viewer
    assert.equal(code(() => svc.getDocument(u1, mine.id + 1)), '404:not_found'); // begona hujjat — mavjudligi ham bildirilmaydi
    assert.deepEqual(svc.listTasks(u1, { page: 1, per_page: 20 }).data.map((x) => x.doc_number), ['M-1']);
    assert.equal(svc.stats(u1, {}).total, 1);
    assert.equal(svc.stats(admin.user, {}).total, 2);
    assert.equal(code(() => svc.listSms(u1)), '403:forbidden');
    assert.equal(code(() => svc.listSms(ctx('U003').user)), '403:forbidden');
    assert.equal(svc.listSms(ctx('U002').user).length, 2);
  } finally { await close(); }
});

test('hujjatlar ro‘yxati filtrlari: holat, hujjat holati, sana oralig‘i va sahifalash', async () => {
  const { t, svc, admin, close } = await env();
  try {
    svc.createDocument(admin, newDoc({ number: 'F-1', deadline: '2026-11-09' })); // new (bajaruvchisiz)
    svc.createDocument(admin, newDoc({ number: 'F-2', deadline: '2026-11-09', assignee: id(t, 'U001') })); // prog
    svc.createDocument(admin, newDoc({ number: 'F-3', deadline: '2026-11-09', signers: [id(t, 'U001')] }));
    const L = (f) => svc.listDocuments(admin.user, { page: 1, per_page: 20, ...f }).data.map((d) => d.number).sort();
    assert.deepEqual(L({ status: 'new' }), ['F-1', 'F-3']);
    assert.deepEqual(L({ status: 'prog' }), ['F-2']);
    assert.deepEqual(L({ doc_status: 'signing' }), ['F-3']);
    assert.deepEqual(L({ date_from: '2026-11-08' }), []);
    assert.equal(code(() => svc.listDocuments(admin.user, { page: 1, per_page: 20, date_from: '2026-12-01', date_to: '2026-01-01' })), '422:validation_error');
    const p2 = svc.listDocuments(admin.user, { page: 2, per_page: 2 });
    assert.equal(p2.data.length, 1);
    assert.deepEqual(p2.meta, { page: 2, per_page: 2, total: 3, total_pages: 2 });
    assert.equal(svc.listDocuments(admin.user, { page: 9, per_page: 2 }).data.length, 0);
  } finally { await close(); }
});

test('topshiriqlar va statistika: davr filtri (yil/oy)', async () => {
  const { t, svc, admin, close } = await env();
  try {
    svc.createDocument(admin, newDoc({ assignee: id(t, 'U001') }));
    t.clock.t = new Date('2026-12-15T08:00:00Z');
    svc.createDocument(admin, newDoc({ deadline: '2026-12-30' }));
    const L = (f) => svc.listTasks(admin.user, { page: 1, per_page: 20, ...f }).meta.total;
    assert.equal(L({}), 2);
    assert.equal(L({ year: 2026, month: 11 }), 1);
    assert.equal(L({ year: 2026, month: 12 }), 1);
    assert.equal(L({ year: 2025 }), 0);
    assert.equal(L({ status: 'new' }), 1);
    assert.equal(code(() => svc.listTasks(admin.user, { page: 1, per_page: 20, month: 3 })), '422:validation_error');
    assert.equal(code(() => svc.stats(admin.user, { month: 3 })), '422:validation_error');
    const s = svc.stats(admin.user, { year: 2026, month: 12 });
    assert.deepEqual({ total: s.total, new: s.new, month: s.month, year: s.year }, { total: 1, new: 1, month: 12, year: 2026 });
    assert.equal(svc.stats(admin.user, {}).year, 2026); // yil berilmasa — joriy yil
  } finally { await close(); }
});

test('login: faol bo‘lmagan, parolsiz va noto‘g‘ri parol bir xil xato; audit yoziladi, parol yozilmaydi', async () => {
  const { t, svc, close } = await env();
  try {
    const ctx = { user: null, ip: '9.9.9.9' };
    t.db.prepare("UPDATE users SET active = 0 WHERE code = 'U005'").run();
    t.db.prepare("UPDATE users SET password_hash = NULL WHERE code = 'U006'").run();
    const bad = [{ id: 'U005', password: 'demopass1' }, { id: 'U006', password: 'demopass1' }, { id: 'admin', password: 'xato' }, { id: 'YOQ', password: 'x' }];
    for (const b of bad) {
      assert.equal(code(() => svc.login(ctx, b)), '401:invalid_credentials', b.id);
    }
    const ok = svc.login(ctx, { id: 'admin', password: 'adminpass1' });
    assert.equal(ok.user.role, 'admin');
    assert.ok(!('password_hash' in ok.user));
    const { rows } = t.repo.listAudit({ limit: 50, offset: 0 });
    assert.equal(rows.filter((r) => r.action === 'login_failed').length, 4);
    assert.equal(rows.filter((r) => r.action === 'login').length, 1);
    assert.ok(!JSON.stringify(rows).includes('xato"') && !JSON.stringify(rows).includes('adminpass1'));
  } finally { await close(); }
});

test('audit: o‘zgartiruvchi amallar yoziladi (kim, nima, IP)', async () => {
  const { t, svc, admin, close } = await env();
  try {
    const d = svc.createDocument(admin, newDoc({ number: 'AU-1' }));
    svc.send(admin, d.id, 2);
    svc.deleteDocument(admin, d.id);
    const actions = t.repo.listAudit({ limit: 10, offset: 0 }).rows.map((r) => r.action);
    assert.deepEqual(actions, ['document_delete', 'document_send', 'document_create']);
    const row = t.repo.listAudit({ limit: 1, offset: 0 }).rows[0];
    assert.equal(row.user_id, admin.user.id);
    assert.equal(row.ip, '10.0.0.1');
    assert.deepEqual(row.details, { number: 'AU-1' });
  } finally { await close(); }
});
