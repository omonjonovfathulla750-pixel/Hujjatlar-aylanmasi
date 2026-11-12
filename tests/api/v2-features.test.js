import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayIn } from '../../src/dates.js';
import { id, newDoc, setupRoles, startTestApp } from '../helpers.js';

async function env(opts) {
  const t = await startTestApp(opts);
  setupRoles(t);
  const admin = await t.tokenFor('admin');
  return { t, admin, close: () => t.close() };
}

test('tashkilot yaratish va hujjatda bo‘lim (department) hamda muhimlik saqlanishi', async () => {
  const { t, admin, close } = await env();
  try {
    const org = await t.api('POST', '/organizations', { token: admin, body: { name: 'Yangi Tashkilot' } });
    assert.equal(org.status, 201);
    assert.equal(org.body.name, 'Yangi Tashkilot');
    assert.equal((await t.api('POST', '/organizations', { token: admin, body: { name: 'yangi tashkilot' } })).status, 409);

    const userTok = await t.tokenFor('U001');
    assert.equal((await t.api('POST', '/organizations', { token: userTok, body: { name: 'X' } })).status, 403);

    const doc = await t.api('POST', '/documents', {
      token: admin,
      body: newDoc({ org_id: org.body.id, department: 'Axborot bo‘limi', priority: 'urgent', assignee: id(t, 'U001') }),
    });
    assert.equal(doc.status, 201);
    assert.equal(doc.body.department, 'Axborot bo‘limi');
    assert.equal(doc.body.priority, 'urgent');

    const boot = await t.api('GET', '/data', { token: admin });
    assert.equal(boot.body.docs[0].department, 'Axborot bo‘limi');
    assert.equal(boot.body.docs[0].priority, 'urgent');
  } finally { await close(); }
});

test('fayl yuklash (hujjat va xodim javob fayli), yuklab olish va RBAC tekshiruvi', async () => {
  const { t, admin, close } = await env();
  try {
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: id(t, 'U001') }) })).body;
    const aid = doc.tasks[0].assignees[0].id;
    const samplePdf = Buffer.from('%PDF-1.4\n%test-pdf-content').toString('base64');

    // Ruxsat etilmagan kengaytma (.html) rad etiladi
    const badFile = await t.api('POST', `/documents/${doc.id}/files`, {
      token: admin,
      body: { filename: 'evil.html', data_base64: Buffer.from('<script>alert(1)</script>').toString('base64') },
    });
    assert.equal(badFile.status, 422);

    // Admin hujjatga PDF biriktiradi
    const up = await t.api('POST', `/documents/${doc.id}/files`, {
      token: admin,
      body: { filename: 'topshiriq.pdf', mime_type: 'application/pdf', data_base64: samplePdf },
    });
    assert.equal(up.status, 201);
    assert.equal(up.body.orig_name, 'topshiriq.pdf');

    // Xodim (U001) javob faylini yuklaydi
    const u1 = await t.tokenFor('U001');
    const respText = Buffer.from('Bajarildi hisobot matni').toString('base64');
    const upResp = await t.api('POST', `/assignees/${aid}/files`, {
      token: u1,
      body: { filename: 'javob.txt', data_base64: respText },
    });
    assert.equal(upResp.status, 201);
    assert.equal(upResp.body.kind, 'response');

    // Begona xodim (U004) na faylni ko'ra oladi, na yuklab oladi
    const u4 = await t.tokenFor('U004');
    const dlForbidden = await fetch(`${t.base}/api/v1/attachments/${up.body.id}/download`, { headers: { Authorization: `Bearer ${u4}` } });
    assert.equal(dlForbidden.status, 404);

    // U001 faylni yuklab oladi
    const dlOk = await fetch(`${t.base}/api/v1/attachments/${up.body.id}/download`, { headers: { Authorization: `Bearer ${u1}` } });
    assert.equal(dlOk.status, 200);
    assert.match(dlOk.headers.get('content-disposition'), /topshiriq\.pdf/);
    assert.equal(Buffer.from(await dlOk.arrayBuffer()).toString(), '%PDF-1.4\n%test-pdf-content');

    // /data va /documents/:id ichida fayllar va javob fayllari ko'rinadi
    const boot = await t.api('GET', '/data', { token: admin });
    assert.equal(boot.body.docs[0].attachments.length, 1);
    assert.equal(boot.body.docs[0].tasks[0].assignees[0].files.length, 1);
    assert.ok(boot.body.docs[0].tasks[0].assignees[0].viewed_at);

    // Timeline da fayl voqealari ko'rinadi
    const tl = await t.api('GET', `/documents/${doc.id}/timeline`, { token: admin });
    assert.ok(tl.body.timeline.some((e) => e.type === 'file_uploaded'));
    assert.ok(tl.body.timeline.some((e) => e.type === 'response_file'));
  } finally { await close(); }
});

test('delegatsiya va ko‘rish vaqti bazada saqlanadi hamda yangi xodimga ko‘rinadi', async () => {
  const { t, admin, close } = await env();
  try {
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: id(t, 'U001') }) })).body;
    const aid = doc.tasks[0].assignees[0].id;
    const u1 = await t.tokenFor('U001');
    const u4 = await t.tokenFor('U004');

    // U001 hujjatni ochganda viewed_at avtomatik yoziladi
    const g1 = await t.api('GET', `/documents/${doc.id}`, { token: u1 });
    assert.ok(g1.body.tasks[0].assignees[0].viewed_at);

    // U001 U004 ga uzatadi
    const del = await t.api('POST', `/assignees/${aid}/delegate`, {
      token: u1,
      body: { user_id: id(t, 'U004'), note: 'Iltimos ko‘rib chiqing' },
    });
    assert.equal(del.status, 200);

    // Endi U004 ham hujjatni ko'ra oladi va bajara oladi
    const g4 = await t.api('GET', `/documents/${doc.id}`, { token: u4 });
    assert.equal(g4.status, 200);
    assert.equal(g4.body.tasks[0].assignees.length, 2);
    assert.equal(g4.body.tasks[0].assignees[0].delegated_to, id(t, 'U004'));

    // /data (reload) dan keyin ham delegatsiya va viewed_at yo'qolib qolmaydi
    const boot = await t.api('GET', '/data', { token: admin });
    const a0 = boot.body.docs[0].tasks[0].assignees[0];
    assert.ok(a0.viewed_at);
    assert.equal(a0.delegated_to, id(t, 'U004'));
    assert.equal(a0.delegation_note, 'Iltimos ko‘rib chiqing');
  } finally { await close(); }
});

test('maxfiy xodim qo‘shish va majburiy parolni o‘zgartirish', async () => {
  const { t, admin, close } = await env();
  try {
    const created = await t.api('POST', '/users', {
      token: admin,
      body: {
        name: 'Yangi Xodim', org_id: 1, department: 'Moliya bo‘limi',
        pos: 'Mutaxassis', role: 'user', code: 'U099', password: 'TempPass123', auth_reset_required: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.department, 'Moliya bo‘limi');
    assert.equal(created.body.auth_reset_required, true);

    const loginRes = await t.api('POST', '/auth/login', { body: { id: 'U099', password: 'TempPass123' } });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.auth_reset_required, true);

    // Xodim o'z parolini o'zgartiradi
    const chg = await t.api('POST', '/auth/change-password', {
      token: loginRes.body.access_token,
      body: { current_password: 'TempPass123', new_password: 'MySecretNew99' },
    });
    assert.equal(chg.status, 200);
    assert.equal(chg.body.user.auth_reset_required, false);
    assert.ok(chg.body.access_token);

    // Yangi parol bilan kirish
    const login2 = await t.api('POST', '/auth/login', { body: { id: 'U099', password: 'MySecretNew99' } });
    assert.equal(login2.status, 200);
    assert.equal(login2.body.user.auth_reset_required, false);
  } finally { await close(); }
});

test('Excel (.xlsx) va Word (.docx) eksporti statistika va barcha topshiriqlarni to‘g‘ri ko‘rsatadi', async () => {
  const { previewXlsx, previewDocx } = await import('../../src/preview.js');
  const { t, admin, close } = await env();
  try {
    const today = todayIn('Asia/Tashkent');
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));

    // 1 ta bajarilgan (ok) va 1 ta jarayonda (prog) topshiriq yaratamiz
    const docDone = (await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'EXP-1', title: 'Bajarilgan hujjat', deadline: addDays(today, 5), assignee: id(t, 'U001') }) })).body;
    const aidDone = docDone.tasks[0].assignees[0].id;
    const u1Tok = await t.tokenFor('U001');
    await t.api('POST', `/assignees/${aidDone}/files`, { token: u1Tok, body: { filename: 'hisobot.txt', data_base64: Buffer.from('ok').toString('base64') } });

    await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'EXP-2', title: 'Jarayondagi hujjat', deadline: addDays(today, 6), assignee: id(t, 'U004') }) });

    const stats = await t.api('GET', `/stats/summary?year=${year}&month=${month}`, { token: admin });
    assert.equal(stats.body.total, 2);
    assert.equal(stats.body.ok, 1);
    assert.equal(stats.body.prog, 1);
    assert.equal(stats.body.pct, 50);

    const xlsx = await fetch(`${t.base}/api/v1/reports/export.xlsx?year=${year}&month=${month}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get('content-type'), /spreadsheetml\.sheet/);
    assert.match(xlsx.headers.get('content-disposition'), /\.xlsx/);
    const xBuf = Buffer.from(await xlsx.arrayBuffer());
    assert.equal(xBuf.subarray(0, 2).toString(), 'PK'); // ZIP header
    const px = previewXlsx(xBuf);
    assert.equal(px.kind, 'xlsx');
    assert.equal(px.sheets.length, 2);
    // 1-varaqda ham statistika raqamlari, ham 2 ta topshiriq bo‘lishi shart
    const s1Flat = px.sheets[0].rows.map((r) => r.join(' | '));
    assert.ok(s1Flat.some((r) => r.includes('Jami topshiriqlar') && r.includes('2') && r.includes('100%')));
    assert.ok(s1Flat.some((r) => r.includes('Vaqtida bajarildi') && r.includes('50%')));
    assert.ok(s1Flat.some((r) => r.includes('EXP-1') && r.includes('Vaqtida bajarildi')));
    assert.ok(s1Flat.some((r) => r.includes('EXP-2') && r.includes('Jarayonda')));
    // 2-varaqda statistika va tashkilot kesimi
    const s2Flat = px.sheets[1].rows.map((r) => r.join(' | '));
    assert.ok(s2Flat.some((r) => r.includes('Samaradorlik (%)') && r.includes('50')));

    const docx = await fetch(`${t.base}/api/v1/reports/export.docx?year=${year}&month=${month}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(docx.status, 200);
    assert.match(docx.headers.get('content-type'), /wordprocessingml\.document/);
    assert.match(docx.headers.get('content-disposition'), /\.docx/);
    const dBuf = Buffer.from(await docx.arrayBuffer());
    assert.equal(dBuf.subarray(0, 2).toString(), 'PK'); // ZIP header
    const pd = previewDocx(dBuf);
    assert.equal(pd.kind, 'docx');
    assert.ok(pd.tables.length >= 2);
    const statTbl = pd.tables[0].map((r) => r.join(' | '));
    assert.ok(statTbl.some((r) => r.includes('Jami topshiriqlar') && r.includes('2 ta')));
    assert.ok(statTbl.some((r) => r.includes('Vaqtida bajarildi') && r.includes('1 ta') && r.includes('50%')));
    const mainTbl = pd.tables[pd.tables.length - 1].map((r) => r.join(' | '));
    assert.ok(mainTbl.some((r) => r.includes('EXP-1') && r.includes('Vaqtida bajarildi')));
    assert.ok(mainTbl.some((r) => r.includes('EXP-2') && r.includes('Jarayonda')));
  } finally { await close(); }
});

test('admin xodimni o‘chira oladi (topshiriq/imzo/fayllari bo‘lsa ham), o‘zini o‘chira olmaydi', async () => {
  const { t, admin, close } = await env();
  try {
    const u1Id = id(t, 'U001');
    const u1Tok = await t.tokenFor('U001');
    // U001 ga topshiriq va imzo biriktiramiz
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: u1Id, signers: [u1Id] }) })).body;
    const aid = doc.tasks[0].assignees[0].id;
    await t.api('POST', `/assignees/${aid}/files`, { token: u1Tok, body: { filename: 'x.txt', data_base64: Buffer.from('ok').toString('base64') } });

    // Oddiy xodim o'chira olmaydi
    assert.equal((await t.api('DELETE', `/users/${u1Id}`, { token: u1Tok })).status, 403);
    // Admin o'zini o'chira olmaydi
    assert.equal((await t.api('DELETE', `/users/${id(t, 'admin')}`, { token: admin })).status, 422);

    // Admin U001 ni muammosiz o'chiradi
    const del = await t.api('DELETE', `/users/${u1Id}`, { token: admin });
    assert.equal(del.status, 204);
    assert.equal(t.repo.userById(u1Id), null);
    assert.equal((await t.api('DELETE', `/users/${u1Id}`, { token: admin })).status, 404);
  } finally { await close(); }
});

test('haqiqiy (production/development) rejimda faqat standart akkauntlar (admin va U001) yaratiladi, qolgan demo xodimlar (U002..U008) yaratilmaydi', async () => {
  const { openDb } = await import('../../src/db.js');
  const { createRepo } = await import('../../src/repo.js');
  const { seedBase } = await import('../../src/seed.js');
  const { loadConfig } = await import('../../src/config.js');
  const { verifyPassword } = await import('../../src/auth.js');
  const db = openDb(':memory:');
  try {
    const repo = createRepo(db);
    const cfg = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 's'.repeat(32), ADMIN_PASSWORD: 'StrongPass123' });
    seedBase(repo, cfg);
    assert.equal(repo.countUsers(), 2);
    assert.equal(repo.userByCode('admin').role, 'admin');
    assert.equal(verifyPassword('StrongPass123', repo.userByCode('admin').password_hash), true);
    assert.equal(repo.userByCode('U001').role, 'user');
    assert.equal(verifyPassword('12345678', repo.userByCode('U001').password_hash), true);
    assert.equal(repo.userByCode('U002'), null);
  } finally { db.close(); }
});

test('POST /auth/register-employee: faqat U001 orqali yangi xodim yaratadi, U001 saqlanadi, dublikat login 409', async () => {
  const { t, admin, close } = await env();
  try {
    const u1Tok = await t.tokenFor('U001');
    const u4Tok = await t.tokenFor('U004');
    // Oddiy xodim yoki admin bu endpointni ishlata olmaydi
    assert.equal((await t.api('POST', '/auth/register-employee', { token: u4Tok, body: { full_name: 'Test', position: 'Mutaxassis', login: 'test_emp', password: 'Password123' } })).status, 403);
    assert.equal((await t.api('POST', '/auth/register-employee', { token: admin, body: { full_name: 'Test', position: 'Mutaxassis', login: 'test_emp2', password: 'Password123' } })).status, 403);
    // Band login (case-insensitive) -> 409
    assert.equal((await t.api('POST', '/auth/register-employee', { token: u1Tok, body: { full_name: 'Test', position: 'Mutaxassis', login: 'ADMIN', password: 'Password123' } })).status, 409);
    // Muvaffaqiyatli ro'yxatdan o'tish
    const res = await t.api('POST', '/auth/register-employee', {
      token: u1Tok,
      body: { full_name: 'Rustam Karimov', position: 'Moliya bo‘limi yetakchi mutaxassisi', login: 'r_karimov', password: 'Password123', password_confirm: 'Password123' },
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.access_token && res.body.refresh_token);
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.onboarding_required, false);
    assert.ok(res.body.user.created_at);
    // U001 o'zgarmagan va faol
    const u001 = t.repo.userByCode('U001');
    assert.ok(u001 && u001.active);
    // Yangi login bilan qayta kirish ishlaydi
    const loginNew = await t.api('POST', '/auth/login', { body: { id: 'r_karimov', password: 'Password123' } });
    assert.equal(loginNew.status, 200);
    assert.equal(loginNew.body.user.onboarding_required, false);
  } finally { await close(); }
});

test('xodim javob fayli yuklashi topshiriqni avtomatik bajarilgan holatga o‘tkazadi; admin o‘zgartira olmaydi', async () => {
  const { t, admin, close } = await env();
  try {
    const today = todayIn('Asia/Tashkent');
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ deadline: addDays(today, 3), assignee: id(t, 'U001') }) })).body;
    const aid = doc.tasks[0].assignees[0].id;
    const u1 = await t.tokenFor('U001');

    // Admin xodim o'rniga done qo'ya olmaydi va javob fayli yuklay olmaydi
    assert.equal((await t.api('PATCH', `/assignees/${aid}`, { token: admin, body: { done_date: today } })).status, 403);
    assert.equal((await t.api('POST', `/assignees/${aid}/files`, { token: admin, body: { filename: 'a.txt', data_base64: Buffer.from('x').toString('base64') } })).status, 403);

    // Xodim javob fayli yuklaydi -> topshiriq avtomatik 'ok' ga o'tadi
    const up = await t.api('POST', `/assignees/${aid}/files`, { token: u1, body: { filename: 'hisobot.txt', data_base64: Buffer.from('Tayyor hisobot').toString('base64') } });
    assert.equal(up.status, 201);
    const updated = await t.api('GET', `/documents/${doc.id}`, { token: admin });
    assert.equal(updated.body.tasks[0].status, 'ok');
    assert.ok(updated.body.tasks[0].assignees[0].done_date);

    // Admin ham, xodim ham /attachments/:id/preview orqali faylni ko'ra oladi
    const pv = await t.api('GET', `/attachments/${up.body.id}/preview`, { token: admin });
    assert.equal(pv.status, 200);
    assert.equal(pv.body.kind, 'text');
    assert.equal(pv.body.text, 'Tayyor hisobot');
  } finally { await close(); }
});

test('Excel (.xlsx) va Word (.docx) fayllarni /attachments/:id/preview orqali o‘qib ko‘rish', async () => {
  const { buildXlsx, buildDocx } = await import('../../src/export.js');
  const { t, admin, close } = await env();
  try {
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: id(t, 'U001') }) })).body;
    const xlsxBuf = buildXlsx({
      periodLabel: '2026-yil',
      summary: { total: 1, ok: 1, late: 0, prog: 0, new: 0, pct: 100, avg_days: 1 },
      rows: [{ number: 'J-1', type: 'Xat', org: 'IIV', department: 'IT', docTitle: 'Jadval', priorityLabel: 'Oddiy', taskTitle: 'Tekshirish', assignee: 'U001', viewedAt: '2026-11-10', deadline: '2026-12-01', doneDate: '2026-11-10', statusLabel: 'Vaqtida bajarildi' }],
    });
    const docxBuf = buildDocx({
      title: 'Sinov Word', periodLabel: '2026', generatedAt: '2026-11-10',
      summary: { total: 1, ok: 1, late: 0, prog: 0, new: 0, pct: 100, avg_days: 1 },
      rows: [],
    });

    const upX = await t.api('POST', `/documents/${doc.id}/files`, { token: admin, body: { filename: 'jadval.xlsx', data_base64: xlsxBuf.toString('base64') } });
    const upD = await t.api('POST', `/documents/${doc.id}/files`, { token: admin, body: { filename: 'xat.docx', data_base64: docxBuf.toString('base64') } });
    assert.equal(upX.status, 201);
    assert.equal(upD.status, 201);

    const u1 = await t.tokenFor('U001');
    const pvX = await t.api('GET', `/attachments/${upX.body.id}/preview`, { token: u1 });
    assert.equal(pvX.status, 200);
    assert.equal(pvX.body.kind, 'xlsx');
    assert.ok(pvX.body.sheets[0].rows.some((r) => r.includes('J-1')));

    const pvD = await t.api('GET', `/attachments/${upD.body.id}/preview`, { token: admin });
    assert.equal(pvD.status, 200);
    assert.equal(pvD.body.kind, 'docx');
    assert.ok(pvD.body.paragraphs.includes('Sinov Word'));
  } finally { await close(); }
});

test('faylni o‘chirish faqat admin uchun; hayot sikli (timeline) vaqtlari haqiqiy ISO vaqtda', async () => {
  const { t, admin, close } = await env();
  try {
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: id(t, 'U001') }) })).body;
    const aid = doc.tasks[0].assignees[0].id;
    const opTok = await t.tokenFor('U002'); // operator
    const u1Tok = await t.tokenFor('U001'); // user

    const fDoc = await t.api('POST', `/documents/${doc.id}/files`, { token: admin, body: { filename: 'doc.txt', data_base64: Buffer.from('a').toString('base64') } });
    const fResp = await t.api('POST', `/assignees/${aid}/files`, { token: u1Tok, body: { filename: 'resp.txt', data_base64: Buffer.from('b').toString('base64') } });
    assert.equal(fDoc.status, 201);
    assert.equal(fResp.status, 201);

    // Operator va xodim faylni o'chira olmaydi (403)
    assert.equal((await t.api('DELETE', `/attachments/${fDoc.body.id}`, { token: opTok })).status, 403);
    assert.equal((await t.api('DELETE', `/attachments/${fResp.body.id}`, { token: u1Tok })).status, 403);

    // Timeline vaqtlari to'g'ri va wait_minutes 0 (soxta 05:00 farq yo'q)
    const tl = await t.api('GET', `/documents/${doc.id}/timeline`, { token: admin });
    assert.equal(tl.status, 200);
    for (const ev of tl.body.timeline) {
      assert.ok(!Number.isNaN(Date.parse(ev.time)), `Noto‘g‘ri sana: ${ev.time}`);
      assert.ok(ev.time.includes('T'), `Aniq vaqt yo‘q: ${ev.time}`);
    }
    const viewed = tl.body.timeline.find((e) => e.type === 'viewed');
    assert.equal(viewed.wait_minutes, 0);

    // Faqat admin o'chira oladi
    assert.equal((await t.api('DELETE', `/attachments/${fResp.body.id}`, { token: admin })).status, 204);
    assert.equal((await t.api('DELETE', `/attachments/${fDoc.body.id}`, { token: admin })).status, 204);
  } finally { await close(); }
});

test('PDF ni iframe ichida ochish chiptasi: X-Frame-Options SAMEORIGIN va frame-ancestors self', async () => {
  const { t, admin, close } = await env();
  try {
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: id(t, 'U001') }) })).body;
    const pdfBytes = Buffer.from('%PDF-1.4\n%inline-preview');
    const up = await t.api('POST', `/documents/${doc.id}/files`, { token: admin, body: { filename: 'hujjat.pdf', data_base64: pdfBytes.toString('base64') } });
    assert.equal(up.status, 201);

    // Begona xodim chipta ololmaydi
    const u4 = await t.tokenFor('U004');
    assert.equal((await t.api('POST', `/attachments/${up.body.id}/ticket`, { token: u4 })).status, 404);

    // Biriktirilgan xodim chipta oladi va iframe uchun inline javob qaytadi
    const u1 = await t.tokenFor('U001');
    const tk = await t.api('POST', `/attachments/${up.body.id}/ticket`, { token: u1 });
    assert.equal(tk.status, 200);
    assert.ok(tk.body.ticket);

    const view = await fetch(`${t.base}/api/v1/attachments/view/${tk.body.ticket}`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(view.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.match(view.headers.get('content-disposition'), /^inline;/);
    assert.equal(Buffer.from(await view.arrayBuffer()).toString(), '%PDF-1.4\n%inline-preview');
  } finally { await close(); }
});

test('admin topshiriqni va xodim biriktiruvini bekor qila oladi (DELETE /tasks/:id, DELETE /assignees/:id)', async () => {
  const { t, admin, close } = await env();
  try {
    const u1 = id(t, 'U001');
    const u4 = id(t, 'U004');
    const u1Tok = await t.tokenFor('U001');
    const opTok = await t.tokenFor('U002');
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'DEL-1', assignee: u1 }) })).body;
    const taskId = doc.tasks[0].id;
    const aid1 = doc.tasks[0].assignees[0].id;
    await t.api('POST', `/tasks/${taskId}/assignees`, { token: admin, body: { user_id: u4 } });
    // U001 javob fayli yuklaydi
    await t.api('POST', `/assignees/${aid1}/files`, { token: u1Tok, body: { filename: 'f.txt', data_base64: Buffer.from('ok').toString('base64') } });

    // Operator va oddiy xodim o'chira olmaydi (403)
    assert.equal((await t.api('DELETE', `/assignees/${aid1}`, { token: u1Tok })).status, 403);
    assert.equal((await t.api('DELETE', `/assignees/${aid1}`, { token: opTok })).status, 403);
    assert.equal((await t.api('DELETE', `/tasks/${taskId}`, { token: opTok })).status, 403);

    // Admin U001 vazifasini bekor qiladi -> faqat U004 qoladi
    assert.equal((await t.api('DELETE', `/assignees/${aid1}`, { token: admin })).status, 204);
    assert.equal((await t.api('DELETE', `/assignees/${aid1}`, { token: admin })).status, 404);
    const afterUnassign = await t.api('GET', `/documents/${doc.id}`, { token: admin });
    assert.equal(afterUnassign.body.tasks[0].assignees.length, 1);
    assert.equal(afterUnassign.body.tasks[0].assignees[0].user_id, u4);

    // Admin butun topshiriqni o'chiradi
    assert.equal((await t.api('DELETE', `/tasks/${taskId}`, { token: admin })).status, 204);
    assert.equal((await t.api('DELETE', `/tasks/${taskId}`, { token: admin })).status, 404);
    const afterDelTask = await t.api('GET', `/documents/${doc.id}`, { token: admin });
    assert.equal(afterDelTask.body.tasks.length, 0);
  } finally { await close(); }
});

test('alohida xodim bo‘yicha statistika, topshiriqlar va eksport filtri (user_id)', async () => {
  const { previewXlsx } = await import('../../src/preview.js');
  const { t, admin, close } = await env({ realClock: true });
  try {
    const today = todayIn('Asia/Tashkent');
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const u1 = id(t, 'U001');
    const u4 = id(t, 'U004');
    const u1Tok = await t.tokenFor('U001');

    // Bitta topshiriqda 2 ta xodim: U001 bajargan, U004 jarayonda
    const d1 = (await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'FLT-1', deadline: addDays(today, 5), assignee: u1 }) })).body;
    await t.api('POST', `/tasks/${d1.tasks[0].id}/assignees`, { token: admin, body: { user_id: u4 } });
    await t.api('PATCH', `/assignees/${d1.tasks[0].assignees[0].id}`, { token: u1Tok, body: { done_date: today } });

    // Yana bitta topshiriq faqat U004 ga (jarayonda)
    await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'FLT-2', deadline: addDays(today, 5), assignee: u4 }) });

    // Umumiy: FLT-1 (U004 tufayli prog) va FLT-2 (prog) => 2 ta jarayonda
    const allStats = await t.api('GET', `/stats/summary?year=${year}&month=${month}`, { token: admin });
    assert.equal(allStats.body.total, 2);
    assert.equal(allStats.body.prog, 2);

    // U001 bo'yicha filtr: 1 ta topshiriq, vaqtida bajarildi = 1 (100%)
    const u1Stats = await t.api('GET', `/stats/summary?year=${year}&month=${month}&user_id=${u1}`, { token: admin });
    assert.equal(u1Stats.body.total, 1);
    assert.equal(u1Stats.body.ok, 1);
    assert.equal(u1Stats.body.pct, 100);

    // U004 bo'yicha filtr: 2 ta topshiriq, jarayonda = 2 (0%)
    const u4Stats = await t.api('GET', `/stats/summary?year=${year}&month=${month}&user_id=${u4}`, { token: admin });
    assert.equal(u4Stats.body.total, 2);
    assert.equal(u4Stats.body.prog, 2);
    assert.equal(u4Stats.body.pct, 0);

    const u1Tasks = await t.api('GET', `/tasks?user_id=${u1}`, { token: admin });
    assert.equal(u1Tasks.body.data.length, 1);
    assert.equal(u1Tasks.body.data[0].status, 'ok');

    // Excel eksporti user_id filtri bilan faqat U001 statistikasini chiqaradi
    const xlsx = await fetch(`${t.base}/api/v1/reports/export.xlsx?year=${year}&month=${month}&user_id=${u1}`, { headers: { Authorization: `Bearer ${admin}` } });
    const px = previewXlsx(Buffer.from(await xlsx.arrayBuffer()));
    const s1 = px.sheets[0].rows.map((r) => r.join(' | '));
    assert.ok(s1.some((r) => r.includes('Vaqtida bajarildi') && r.includes('100%')));
    assert.ok(s1.some((r) => r.includes('FLT-1')));
    assert.ok(!s1.some((r) => r.includes('FLT-2')));
  } finally { await close(); }
});

test('SMS provayder sozlamalari: parol maskalanadi, saqlash va o‘chirish ishlaydi', async () => {
  const { t, admin, close } = await env();
  try {
    const save1 = await t.api('POST', '/integrations/sms_provider', {
      token: admin,
      body: { provider: 'eskiz', api_url: 'https://notify.eskiz.uz/api/message/sms/send', login: 'admin@org.uz', password: 'secret-token', sender: '4546', enabled: true },
    });
    assert.equal(save1.status, 200);
    assert.equal(save1.body.status, 'saved');

    const list1 = await t.api('GET', '/integrations', { token: admin });
    assert.equal(list1.status, 200);
    assert.equal(list1.body.data.length, 1);
    assert.equal(list1.body.data[0].value.password, '');
    assert.equal(list1.body.data[0].value.has_password, true);

    // Parolsiz qayta saqlaganda eski parol saqlanib qoladi
    await t.api('POST', '/integrations/sms_provider', {
      token: admin,
      body: { provider: 'eskiz', api_url: 'https://notify.eskiz.uz/api/message/sms/send', login: 'admin@org.uz', sender: '9999', enabled: false },
    });
    const rawSaved = t.repo.getIntegration('sms_provider');
    assert.equal(rawSaved.value.password, 'secret-token');
    assert.equal(rawSaved.value.sender, '9999');

    const del = await t.api('DELETE', '/integrations/sms_provider', { token: admin });
    assert.equal(del.status, 204);
    assert.equal((await t.api('GET', '/integrations', { token: admin })).body.data.length, 0);
  } finally { await close(); }
});

test('fayl tavsifi (note) saqlanadi va hujjatga fayl biriktirilganda xodimga doc_id bilan bildirishnoma boradi', async () => {
  const { t, admin, close } = await env();
  try {
    const u1 = id(t, 'U001');
    const u1Tok = await t.tokenFor('U001');
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'NOTIF-1', title: 'Buyruq matni', assignee: u1 }) })).body;
    const aid = doc.tasks[0].assignees[0].id;

    // Admin hujjatga tavsifli fayl biriktiradi -> U001 ga bildirishnoma boradi (doc_id bilan)
    const upDoc = await t.api('POST', `/documents/${doc.id}/files`, {
      token: admin,
      body: { filename: 'buyruq.pdf', data_base64: Buffer.from('%PDF-1.4').toString('base64'), note: 'Asosiy jadval ilovasi' },
    });
    assert.equal(upDoc.status, 201);
    assert.equal(upDoc.body.note, 'Asosiy jadval ilovasi');

    const u1Notifs = await t.api('GET', '/notifications', { token: u1Tok });
    assert.equal(u1Notifs.status, 200);
    assert.ok(u1Notifs.body.data.some((n) => n.type === 'file_uploaded' && n.doc_id === doc.id && n.body.includes('Asosiy jadval ilovasi')));
    assert.ok(u1Notifs.body.data.some((n) => n.type === 'new_task' && n.doc_id === doc.id));

    // Xodim javob fayli + tavsif yuklaydi -> admin ga response_file bildirishnoma boradi (doc_id va tavsif bilan)
    const upResp = await t.api('POST', `/assignees/${aid}/files`, {
      token: u1Tok,
      body: { filename: 'javob.txt', data_base64: Buffer.from('ok').toString('base64'), note: 'Barcha bandlar bajarildi' },
    });
    assert.equal(upResp.status, 201);
    assert.equal(upResp.body.note, 'Barcha bandlar bajarildi');

    const loaded = await t.api('GET', `/documents/${doc.id}`, { token: admin });
    assert.equal(loaded.body.attachments[0].note, 'Asosiy jadval ilovasi');
    assert.equal(loaded.body.tasks[0].assignees[0].files[0].note, 'Barcha bandlar bajarildi');

    const admNotifs = await t.api('GET', '/notifications', { token: admin });
    assert.ok(admNotifs.body.data.some((n) => n.type === 'response_file' && n.doc_id === doc.id && n.body.includes('Barcha bandlar bajarildi')));
  } finally { await close(); }
});

test('delegate faqat faol oddiy xodimga ruxsat beradi va operator U001 onboarding belgisini ko‘radi', async () => {
  const { t, admin, close } = await env();
  try {
    const users = t.repo.listUsers();
    const emp1 = users.find((u) => u.role === 'user' && u.code !== 'U001');
    const emp2 = users.find((u) => u.role === 'user' && u.code !== 'U001' && u.id !== emp1.id);
    const op = users.find((u) => u.role === 'operator');
    const adm = users.find((u) => u.role === 'admin');
    const u1 = id(t, 'U001');

    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'DEL-RBAC-1', assignee: emp1.id }) })).body;
    const aid = doc.tasks[0].assignees[0].id;
    const emp1Tok = await t.tokenFor(emp1.code);

    assert.equal((await t.api('POST', `/assignees/${aid}/delegate`, { token: emp1Tok, body: { user_id: emp1.id } })).status, 422);
    assert.equal((await t.api('POST', `/assignees/${aid}/delegate`, { token: emp1Tok, body: { user_id: adm.id } })).status, 422);
    assert.equal((await t.api('POST', `/assignees/${aid}/delegate`, { token: emp1Tok, body: { user_id: u1 } })).status, 422);
    if (op) {
      assert.equal((await t.api('POST', `/assignees/${aid}/delegate`, { token: emp1Tok, body: { user_id: op.id } })).status, 422);
      const opTok = await t.tokenFor(op.code);
      const opData = await t.api('GET', '/data', { token: opTok });
      const opU1 = opData.body.users.find((u) => u.id === u1);
      assert.equal(opU1.onboarding_required, true);
    }
    assert.equal((await t.api('POST', `/assignees/${aid}/delegate`, { token: emp1Tok, body: { user_id: emp2.id, note: 'OK' } })).status, 200);
  } finally { await close(); }
});

test('integratsiya token maskalash, SSRF bloklash, login registrsizligi, viewed deduplikatsiya va clear-demo sessiyasi', async () => {
  const { t, admin, close } = await env();
  try {
    // Login katta-kichik harflarga sezgir emas va clear-demo joriy admin tokenini o'chirmaydi
    const loginRes = await t.api('POST', '/auth/login', { body: { id: 'ADMIN', password: t.config.adminPassword } });
    assert.equal(loginRes.status, 200);
    const admRefresh = loginRes.body.refresh_token;
    const admAccess = loginRes.body.access_token;

    // SSRF himoyasi
    for (const badUrl of ['http://127.0.0.1:8080/hook', 'http://localhost:3000/api', 'http://169.254.169.254/latest', 'http://[::1]:8080/x', 'ftp://example.com/a']) {
      const bad = await t.api('POST', '/integrations/sms_provider', { token: admAccess, body: { api_url: badUrl } });
      assert.equal(bad.status, 422, badUrl);
    }
    assert.equal((await t.api('DELETE', '/integrations/unknown_key', { token: admAccess })).status, 422);

    // token va bot_token maskalash hamda bo'sh yuborilganda saqlanib qolishi
    assert.equal((await t.api('POST', '/integrations/telegram_bot', {
      token: admAccess,
      body: { api_url: 'https://api.telegram.org/bot', token: 'tok-123', bot_token: 'bot-999' },
    })).status, 200);
    const list1 = await t.api('GET', '/integrations', { token: admAccess });
    const tg = list1.body.data.find((x) => x.key === 'telegram_bot');
    assert.equal(tg.value.token, '');
    assert.equal(tg.value.bot_token, '');
    assert.equal(tg.value.has_token, true);
    assert.equal(tg.value.has_bot_token, true);

    await t.api('POST', '/integrations/telegram_bot', {
      token: admAccess,
      body: { api_url: 'https://api.telegram.org/bot', enabled: true },
    });
    const rawTg = t.repo.getIntegration('telegram_bot');
    assert.equal(rawTg.value.token, 'tok-123');
    assert.equal(rawTg.value.bot_token, 'bot-999');

    // Hujjat ko'p marta ochilganda viewed event dublikatlanmaydi
    const doc = (await t.api('POST', '/documents', { token: admAccess, body: newDoc({ number: 'VIEW-1' }) })).body;
    await t.api('GET', `/documents/${doc.id}`, { token: admAccess });
    await t.api('GET', `/documents/${doc.id}`, { token: admAccess });
    await t.api('GET', `/documents/${doc.id}`, { token: admAccess });
    const viewedEvents = t.repo.listEvents(doc.id).filter((e) => e.event_type === 'viewed' && e.user_id === loginRes.body.user.id);
    assert.equal(viewedEvents.length, 1);

    // clear-demo joriy admin sessiyasini (refresh_token) saqlab qoladi
    const clr = await t.api('POST', '/admin/clear-demo', { token: admAccess, body: {} });
    assert.equal(clr.status, 200);
    const refAfter = await t.api('POST', '/auth/refresh', { body: { refresh_token: admRefresh } });
    assert.equal(refAfter.status, 200);
  } finally { await close(); }
});

