// public/app.js ni (DOM o'rniga stub bilan) HAQIQIY API serveriga ulab ishga tushiradi:
// login, token yangilash, rollar bo'yicha ko'rinish, hujjat yaratish, XSS-ekranlash.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { addDays, todayIn } from '../../src/dates.js';
import { setupRoles, startTestApp } from '../helpers.js';

const code = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

function browser(base, storage = new Map()) {
  const els = new Map();
  const mk = () => ({ innerHTML: '', textContent: '', value: '', dataset: {}, onclick: null, onkeydown: null, focus() {} });
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, mk()); return els.get(sel); };
  const listeners = {};
  const alerts = [];
  const state = { reloads: 0, attrs: {}, styles: {} };
  const sandbox = {
    document: {
      querySelector: $, querySelectorAll: () => [],
      addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
      documentElement: {
        setAttribute: (k, v) => { state.attrs[k] = v; },
        removeAttribute: (k) => { delete state.attrs[k]; },
        style: { setProperty: (k, v) => { state.styles[k] = v; } },
      },
    },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    alert: (m) => alerts.push(m),
    location: { reload: () => { state.reloads += 1; } },
    fetch: (u, o) => fetch(base + u, o),
    console, Date, Intl, Promise, JSON, Math, String, Number, Array, Object, Set, Map, FormData, Blob, setTimeout, structuredClone, RegExp, isNaN, parseInt,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);
  const app = () => $('#app').innerHTML;
  return {
    $, storage, alerts, state, app,
    async until(pred, ms = 5000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (pred(app())) return app(); await new Promise((r) => setTimeout(r, 20)); }
      throw new Error(`kutilgan holat yuzaga kelmadi. Joriy HTML boshi: ${app().slice(0, 300)}`);
    },
    click: (dataset) => listeners.click[0]({ target: { closest: () => ({ dataset }) } }),
  };
}

async function loginVia(t, id, password, storage = new Map()) {
  const b = browser(t.base, storage);
  await b.until((h) => h.includes('id="lb"'));
  b.$('#lid').value = id;
  b.$('#lpw').value = password;
  await b.$('#lb').onclick();
  return { storage, b };
}

async function openApp(t, id, password) {
  const { storage } = await loginVia(t, id, password);
  const b = browser(t.base, storage); // "sahifani yangilash"
  await b.until((h) => h.includes('Salom,'));
  return b;
}

test('login oynasi parol so‘raydi va namuna ID lari ko‘rsatilmaydi', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const b = browser(t.base);
    const html = await b.until((h) => h.includes('id="lb"'));
    assert.match(html, /id="lpw" type="password"/);
    assert.ok(!html.includes('U001') && !html.includes('Namuna'));
  } finally { await t.close(); }
});

test('noto‘g‘ri parol: xabar ko‘rsatiladi, token saqlanmaydi', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const { b, storage } = await loginVia(t, 'admin', 'xato-parol');
    assert.equal(b.$('#le').textContent, 'ID yoki parol notoʻgʻri');
    assert.equal(storage.size, 0);
    assert.equal(b.state.reloads, 0);
  } finally { await t.close(); }
});

test('admin: login → dashboard → hujjatlar → yangi hujjat yaratish (XSS ekranlanadi)', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const { storage, b: loginPage } = await loginVia(t, 'admin', 'adminpass1');
    assert.equal(loginPage.state.reloads, 1);
    assert.ok(storage.get('tk') && storage.get('rt'));

    const b = browser(t.base, storage);
    const dash = await b.until((h) => h.includes('Salom,'));
    assert.match(dash, /Salom, Administrator/);
    assert.match(dash, /Administrator paneli/);
    assert.match(dash, /Jami topshiriqlar/);
    assert.match(dash, /Yangi hujjat/);
    assert.match(dash, /Soʻnggi hujjatlar/);
    const year = Number(todayIn('Asia/Tashkent').slice(0, 4));
    assert.match(dash, new RegExp(`${year}-yil`)); // yil qattiq yozilmagan

    await b.click({ a: 'go', p: 'docs' });
    const docs = await b.until((h) => h.includes('<h2>Hujjatlar</h2>'));
    assert.match(docs, /class="rw"/);

    await b.click({ a: 'go', p: 'new' });
    const evil = '<img src=x onerror=alert(1)>';
    b.$('#n-no').value = 'UI-1';
    b.$('#n-ty').value = 'Xat';
    b.$('#n-og').value = '1';
    b.$('#n-dl').value = addDays(todayIn('Asia/Tashkent'), 7);
    b.$('#n-ti').value = evil;
    b.$('#n-as').value = '1';
    await b.click({ a: 'create' });
    const detail = await b.until((h) => h.includes('UI-1'));
    assert.match(detail, /№ UI-1/);
    assert.ok(!detail.includes('<img src=x'), 'XSS: xom teg HTML ga tushdi');
    assert.ok(detail.includes('&lt;img src=x'));
    assert.deepEqual(b.alerts, []);

    // dublikat raqam — server xatosi alert sifatida ko‘rsatiladi
    await b.click({ a: 'go', p: 'new' });
    b.$('#n-no').value = 'UI-1'; b.$('#n-ty').value = 'Xat'; b.$('#n-og').value = '1';
    b.$('#n-dl').value = addDays(todayIn('Asia/Tashkent'), 7); b.$('#n-ti').value = 'x'; b.$('#n-as').value = '';
    await b.click({ a: 'create' });
    assert.match(b.alerts.at(-1), /allaqachon mavjud/);

    // validatsiya xatosi maydon nomi bilan
    b.$('#n-no').value = ''; 
    await b.click({ a: 'create' });
    assert.match(b.alerts.at(-1), /number: /);
  } finally { await t.close(); }
});

test('oddiy xodim: "Yangi hujjat" tugmasi, ID ustuni va SMS bo‘limi ko‘rinmaydi', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const b = await openApp(t, 'U004', 'demopass1');
    const dash = b.app();
    assert.match(dash, /Salom, Rahimov Jasur/);
    assert.match(dash, /Xodim paneli/);
    assert.ok(!dash.includes('Yangi hujjat'));
    await b.click({ a: 'go', p: 'users' });
    const users = await b.until((h) => h.includes('<h2>Xodimlar</h2>'));
    assert.ok(!users.includes('<th>ID / Login</th>'));
    await b.click({ a: 'go', p: 'set' });
    const set = await b.until((h) => h.includes('<h2>Sozlamalar</h2>'));
    assert.ok(!set.includes('SMS navbati'));
    assert.ok(!set.includes('SMS provayderini'));
  } finally { await t.close(); }
});

test('admin: ID ustuni va SMS provayder bo‘limi ko‘rinadi (demo SMS navbati yo‘q); operator — ID/SMS provayder yo‘q; viewer — faqat o‘qish', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  await setupRoles(t); // U002 = operator, U003 = viewer
  try {
    const adm = await openApp(t, 'admin', 'adminpass1');
    await adm.click({ a: 'go', p: 'users' });
    assert.match(await adm.until((h) => h.includes('<h2>Xodimlar</h2>')), /<th>ID \/ Login<\/th>/);
    await adm.click({ a: 'go', p: 'set' });
    const admSet = await adm.until((h) => h.includes('<h2>Sozlamalar</h2>'));
    assert.match(admSet, /SMS provayderini oʻrnatish/);
    assert.ok(!admSet.includes('SMS navbati'));

    const op = await openApp(t, 'U002', 'demopass1');
    assert.match(op.app(), /Yangi hujjat/);
    await op.click({ a: 'go', p: 'users' });
    assert.ok(!(await op.until((h) => h.includes('<h2>Xodimlar</h2>'))).includes('<th>ID / Login</th>'));
    await op.click({ a: 'go', p: 'set' });
    const opSet = await op.until((h) => h.includes('<h2>Sozlamalar</h2>'));
    assert.ok(!opSet.includes('SMS navbati'));
    assert.ok(!opSet.includes('SMS provayderini'));

    const vw = await openApp(t, 'U003', 'demopass1');
    assert.ok(!vw.app().includes('Yangi hujjat'));
    assert.match(vw.app(), /Jami topshiriqlar/);
    // viewer hujjat sahifasida o‘zgartirish tugmalarini ko‘rmaydi
    const doc = (await t.repo.findDocs())[0];
    await vw.click({ a: 'doc', id: String(doc.id) });
    const detail = await vw.until((h) => h.includes(`№ ${doc.number}`));
    assert.ok(!detail.includes('data-a="done"') && !detail.includes('data-a="assign"') && !detail.includes('data-a="send"') && !detail.includes('data-a="del-doc"') && !detail.includes('data-a="del-task"'));
  } finally { await t.close(); }
});

test('access token eskirganda ilova refresh orqali sezdirmasdan davom etadi', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const { storage } = await loginVia(t, 'admin', 'adminpass1');
    const oldRefresh = storage.get('rt');
    storage.set('tk', 'eskirgan.yoki.buzuq');
    const b = browser(t.base, storage);
    await b.until((h) => h.includes('Salom,'));
    assert.notEqual(storage.get('tk'), 'eskirgan.yoki.buzuq');
    assert.notEqual(storage.get('rt'), oldRefresh); // rotation
    assert.deepEqual(b.alerts, []);
    assert.equal(b.state.reloads, 0);
  } finally { await t.close(); }
});

test('ikkala token yaroqsiz bo‘lsa — tokenlar tozalanadi va login sahifasiga qaytiladi (xatosiz)', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const storage = new Map([['tk', 'yaroqsiz'], ['rt', 'yaroqsiz']]);
    const b = browser(t.base, storage);
    const end = Date.now() + 5000;
    while (b.state.reloads === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.state.reloads, 1);
    assert.equal(storage.size, 0);
  } finally { await t.close(); }
});

test('chiqish: refresh token serverda bekor qilinadi', async () => {
  const t = await startTestApp({ demo: true, realClock: true });
  try {
    const b = await openApp(t, 'admin', 'adminpass1');
    const rt = b.storage.get('rt');
    await b.click({ a: 'out' });
    assert.equal(b.storage.size, 0);
    assert.ok(b.state.reloads >= 1);
    const r = await t.api('POST', '/auth/refresh', { body: { refresh_token: rt } });
    assert.equal(r.status, 401);
  } finally { await t.close(); }
});

test('bajarildi tugmasi: xodim o‘z topshirig‘ini belgilaydi va holat yangilanadi', async () => {
  const t = await startTestApp({ demo: false, realClock: true });
  try {
    const admin = await t.tokenFor('admin');
    const today = todayIn('Asia/Tashkent');
    const u4Id = (await t.repo.userByCode('U004')).id;
    const created = await t.api('POST', '/documents', { token: admin, body: { number: 'UI-DONE', type: 'Xat', org_id: 1, deadline: addDays(today, 3), title: 'Bajarish', assignee: u4Id } });
    const b = await openApp(t, 'U004', 'demopass1');
    await b.click({ a: 'doc', id: String(created.body.id) });
    const before = await b.until((h) => h.includes('№ UI-DONE'));
    assert.match(before, /✓ Bajarildi/);
    const aid = created.body.tasks[0].assignees[0].id;
    await b.click({ a: 'done', id: String(aid), v: '1' });
    const after = await b.until((h) => h.includes(`✓ ${today}`));
    assert.match(after, /Vaqtida bajarildi/);
    assert.equal((await t.repo.docById(created.body.id)).tasks[0].assignees[0].done_date, today);
  } finally { await t.close(); }
});

test('hujjat sahifasida keraksiz Imzolar va Tashkilotlararo almashinuv bo‘limlari ko‘rsatilmaydi', async () => {
  const t = await startTestApp({ demo: false, realClock: true });
  try {
    const admin = await t.tokenFor('admin');
    const today = todayIn('Asia/Tashkent');
    const c = await t.api('POST', '/documents', { token: admin, body: { number: 'UI-CLEAN', type: 'Xat', org_id: 1, deadline: addDays(today, 5), title: 'Toza ko‘rinish', assignee: 1 } });

    const adm = await openApp(t, 'admin', 'adminpass1');
    await adm.click({ a: 'go', p: 'new' });
    const newDocHtml = await adm.until((h) => h.includes('<h2>Yangi hujjat</h2>'));
    assert.ok(!newDocHtml.includes('Imzolovchilar'));

    await adm.click({ a: 'doc', id: String(c.body.id) });
    const detail = await adm.until((h) => h.includes('№ UI-CLEAN'));
    assert.ok(!detail.includes('<h3>Imzolar</h3>'));
    assert.ok(!detail.includes('Tashkilotlararo almashinuv'));
    assert.deepEqual(adm.alerts, []);
  } finally { await t.close(); }
});

test('dashboard: alohida filtrlar, xodim statistikasi va admin uchun o‘chirish tugmalari ko‘rinadi', async () => {
  const t = await startTestApp({ demo: false, realClock: true });
  try {
    const admin = await t.tokenFor('admin');
    const today = todayIn('Asia/Tashkent');
    const c = await t.api('POST', '/documents', { token: admin, body: { number: 'UI-FLT', type: 'Xat', org_id: 1, deadline: addDays(today, 4), title: 'Filtr testi', assignee: 1 } });
    const b = await openApp(t, 'admin', 'adminpass1');
    const dash = b.app();
    assert.match(dash, /Barcha xodimlar/);
    assert.match(dash, /Barcha tashkilotlar/);
    assert.match(dash, /Barcha holatlar/);
    assert.match(dash, /Xodimlar boʻyicha ijro statistikasi/);
    assert.match(dash, /Topshiriqlar va bajarilish holati/);

    // Bitta xodimni tanlash (U004)
    const u4Id = String((await t.repo.userByCode('U004')).id);
    await b.click({ a: 'pick-emp', uid: u4Id });
    const empDash = await b.until((h) => h.includes('Barcha xodimlarga qaytish'));
    assert.match(empDash, /Rahimov Jasur/);

    // Hujjat sahifasida admin uchun hujjat/topshiriq/vazifa o'chirish tugmalari bor
    await b.click({ a: 'doc', id: String(c.body.id) });
    const detail = await b.until((h) => h.includes('№ UI-FLT'));
    assert.match(detail, /data-a="del-doc"/);
    assert.match(detail, /data-a="del-task"/);
    assert.match(detail, /data-a="del-assignee"/);
  } finally { await t.close(); }
});

test('bildirishnoma: qo‘ng‘iroqcha ochilganda o‘qilgan bo‘ladi, tavsif bosilganda hujjatga o‘tadi va javobda tavsif shart', async () => {
  const t = await startTestApp({ demo: false, realClock: true });
  try {
    const admin = await t.tokenFor('admin');
    const today = todayIn('Asia/Tashkent');
    const u4Id = (await t.repo.userByCode('U004')).id;
    const c = await t.api('POST', '/documents', { token: admin, body: { number: 'UI-NTF', type: 'Xat', org_id: 1, deadline: addDays(today, 4), title: 'Bildirishnoma tavsifi', assignee: u4Id } });
    const aid = c.body.tasks[0].assignees[0].id;

    const u4 = await openApp(t, 'U004', 'demopass1');
    // Dastlab 1 ta o'qilmagan bildirishnoma bor
    assert.match(u4.app(), /Bildirishnomalar/);
    assert.equal((await t.api('GET', '/notifications/unread', { token: await t.tokenFor('U004') })).body.count, 1);

    // Qo'ng'iroqchani ochganda avtomatik o'qilgan deb belgilanadi (badge yo'qoladi)
    await u4.click({ a: 'go', p: 'notif' });
    const nPage = await u4.until((h) => h.includes('Bildirishnoma tavsifi'));
    assert.match(nPage, new RegExp(`data-a="open-notif" data-doc="${c.body.id}"`));
    assert.equal((await t.api('GET', '/notifications/unread', { token: await t.tokenFor('U004') })).body.count, 0);

    // Bildirishnoma tavsifiga bosilganda aynan o'sha hujjatga o'tadi va viewed_at qayd etiladi
    await u4.click({ a: 'open-notif', doc: String(c.body.id) });
    const docView = await u4.until((h) => h.includes('№ UI-NTF'));
    assert.match(docView, /Javob tavsifi \(majburiy\)/);
    assert.ok((await t.repo.docById(c.body.id)).tasks[0].assignees[0].viewed_at);

    // Javob fayli tanlanib tavsif yozilmasa, ogohlantirish chiqadi
    u4.$(`#rf${aid}`).files = [{ name: 'test.txt', size: 10, type: 'text/plain' }];
    u4.$(`#rn${aid}`).value = '   ';
    await u4.click({ a: 'up-resp', aid: String(aid) });
    assert.match(u4.alerts.at(-1), /tavsif yozish shart/i);
  } finally { await t.close(); }
});

test('mavzu va rang yangilangandan keyin saqlanadi; kalendar va KPI boshqaruv oynasini 0 ga tushirib qo‘ymaydi', async () => {
  const t = await startTestApp({ demo: false, realClock: true });
  try {
    const admin = await t.tokenFor('admin');
    const today = todayIn('Asia/Tashkent');
    await t.api('POST', '/documents', { token: admin, body: { number: 'UI-KEEP', type: 'Xat', org_id: 1, deadline: addDays(today, 5), title: 'Saqlash testi', assignee: 1 } });

    const { storage } = await loginVia(t, 'admin', 'adminpass1');
    const b1 = browser(t.base, storage);
    const h1 = await b1.until((h) => h.includes('Salom,'));
    assert.match(h1, /id="q"[^>]*autocomplete="off"[^>]*readonly/);

    await b1.click({ a: 'go', p: 'set' });
    await b1.until((h) => h.includes('<h2>Sozlamalar</h2>'));
    await b1.click({ a: 'theme', v: 'light' });
    await b1.click({ a: 'accent', v: '#1fbf84' });
    assert.equal(b1.state.attrs['data-theme'], 'light');
    assert.equal(b1.state.styles['--pri'], '#1fbf84');

    // Yangilashdan (yangi browser konteksti) keyin ham tanlangan rejim va rang saqlanib qoladi
    const b2 = browser(t.base, storage);
    await b2.until((h) => h.includes('Salom,'));
    assert.equal(b2.state.attrs['data-theme'], 'light');
    assert.equal(b2.state.styles['--pri'], '#1fbf84');

    // Kalendarda oy surish va 0 li KPI bosilgandan keyin Dashboard/Hujjatlarga qaytish 0 qilib qo'ymaydi
    await b2.click({ a: 'go', p: 'cal' });
    await b2.click({ a: 'cm', v: '-1' });
    await b2.click({ a: 'go', p: 'dash' });
    const dashAfterCal = await b2.until((h) => h.includes('Salom,'));
    assert.match(dashAfterCal, /UI-KEEP/);

    await b2.click({ a: 'go', p: 'tasks', s: 'late' });
    await b2.click({ a: 'go', p: 'docs' });
    const docsAfterKpi = await b2.until((h) => h.includes('<h2>Hujjatlar</h2>'));
    assert.match(docsAfterKpi, /UI-KEEP/);
  } finally { await t.close(); }
});

test('veb-ilovadagi barcha API yo‘llari serverda mavjud (404 bermaydi)', async () => {
  const t = await startTestApp({ demo: false });
  try {
    const used = [...code.matchAll(/api\('([A-Z]+)',\s*[`']([^`',]+)/g)].map((m) => [m[1], m[2].replace(/\$\{[^}]+\}/g, '1').replace(/\/$/, '/1')]); // 'assignees/'+id kabi birlashtirishlar ham
    assert.ok(used.length >= 6, `topilgan yo'llar: ${used.length}`);
    for (const [method, path] of used) {
      const m = t.app.routes.find((r) => r.method === method && new RegExp(`^${r.path.replace(/:key/g, '[^/]+').replace(/:\w+/g, '\\d+')}$`).test(`/${path}`));
      assert.ok(m, `${method} /${path} serverda yo‘q`);
    }
  } finally { await t.close(); }
});

test('U001 shablon onboarding: dashboard yashiriladi, yangi xodim ro‘yxatdan o‘tadi, U001 saqlanadi, admin jadvalida chiqadi', async () => {
  const t = await startTestApp({ demo: false, realClock: true });
  try {
    // 1. U001 bilan kirish -> dashboard yashirilib, majburiy ro'yxatdan o'tish oynasi ochiladi
    const { storage } = await loginVia(t, 'U001', 'demopass1');
    const b = browser(t.base, storage);
    const modal = await b.until((h) => h.includes('Yangi xodimni roʻyxatdan oʻtkazish'));
    assert.ok(!modal.includes('Jami topshiriqlar'));
    assert.ok(!modal.includes('close-modal') && !modal.includes('close-gmodal'));

    // 2. Band qilingan login ('admin' yoki 'U001') rad etiladi
    b.$('#reg-name').value = 'Rustam Karimov';
    b.$('#reg-pos').value = 'Moliya boʻlimi yetakchi mutaxassisi';
    b.$('#reg-org').value = '1';
    b.$('#reg-login').value = 'admin';
    b.$('#reg-pw').value = 'parol1234';
    b.$('#reg-pw2').value = 'parol1234';
    await b.click({ a: 'register-emp' });
    assert.match(b.$('#reg-err').textContent, /band qilingan/i);

    // 3. Unikal login ('r_karimov') bilan ro'yxatdan o'tish -> yangi profilga kirib, shaxsiy dashboardga o'tadi
    b.$('#reg-login').value = 'r_karimov';
    await b.click({ a: 'register-emp' });
    const empDash = await b.until((h) => h.includes('Salom, Rustam Karimov'));
    assert.match(empDash, /Xodim paneli/);

    // 4. U001 shabloni o'zgarmagan va faol; yangi xodim o'z logini bilan qayta kira oladi
    const u001 = await t.repo.userByCode('U001');
    assert.ok(u001 && u001.active);
    const secondLogin = await openApp(t, 'r_karimov', 'parol1234');
    assert.match(secondLogin.app(), /Salom, Rustam Karimov/);

    // 5. Admin panelida yangi xodim va yaratilgan vaqti ko'rinadi hamda topshiriqqa tanlanadi
    const adm = await openApp(t, 'admin', 'adminpass1');
    await adm.click({ a: 'go', p: 'users' });
    const usersHtml = await adm.until((h) => h.includes('r_karimov'));
    assert.match(usersHtml, /Rustam Karimov/);
    assert.match(usersHtml, /Moliya boʻlimi yetakchi mutaxassisi/);
    assert.match(usersHtml, /Roʻyxatdan oʻtgan/);

    await adm.click({ a: 'go', p: 'new' });
    const newDocHtml = await adm.until((h) => h.includes('<h2>Yangi hujjat</h2>'));
    assert.match(newDocHtml, /Rustam Karimov/);
  } finally { await t.close(); }
});
