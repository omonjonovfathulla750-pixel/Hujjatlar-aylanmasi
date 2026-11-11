import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startTestApp } from '../helpers.js';

const ORIGIN = 'https://admin.example.uz';

test('xavfsizlik sarlavhalari va no-store API javoblarida', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('GET', '/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /application\/json; charset=utf-8/);
    assert.match(r.headers.get('x-request-id'), /^[0-9a-f]{8}$/);
    assert.notEqual(r.headers.get('x-request-id'), (await t.api('GET', '/health')).headers.get('x-request-id'));
    assert.equal(r.headers.get('x-powered-by'), null);
  } finally { await t.close(); }
});

test('CORS: ruxsat etilgan admin paneli domeni — ha, boshqalar — yo‘q', async () => {
  const t = await startTestApp({ env: { CORS_ORIGINS: ORIGIN } });
  try {
    const ok = await t.api('GET', '/health', { headers: { Origin: ORIGIN } });
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(ok.headers.get('vary'), 'Origin');
    assert.match(ok.headers.get('access-control-expose-headers'), /X-Request-Id/);
    assert.equal(ok.headers.get('access-control-allow-credentials'), null); // cookie ishlatilmaydi

    const bad = await t.api('GET', '/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    assert.equal(bad.status, 200); // server javob beradi, lekin brauzer o‘qiy olmaydi

    const none = await t.api('GET', '/health');
    assert.equal(none.headers.get('access-control-allow-origin'), null);
  } finally { await t.close(); }
});

test('CORS preflight (OPTIONS): ruxsat etilgan domen uchun metod va sarlavhalar e‘lon qilinadi', async () => {
  const t = await startTestApp({ env: { CORS_ORIGINS: ORIGIN } });
  try {
    const pre = await t.api('OPTIONS', '/documents', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/);
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
    const bad = await t.api('OPTIONS', '/documents', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(bad.status, 204);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  } finally { await t.close(); }
});

test('CORS: bir nechta domen va "*"', async () => {
  const multi = await startTestApp({ env: { CORS_ORIGINS: 'https://a.uz, https://b.uz' } });
  const star = await startTestApp({ env: { CORS_ORIGINS: '*' } });
  try {
    for (const o of ['https://a.uz', 'https://b.uz']) {
      assert.equal((await multi.api('GET', '/health', { headers: { Origin: o } })).headers.get('access-control-allow-origin'), o);
    }
    assert.equal((await multi.api('GET', '/health', { headers: { Origin: 'https://c.uz' } })).headers.get('access-control-allow-origin'), null);
    assert.equal((await star.api('GET', '/health', { headers: { Origin: 'https://istalgan.uz' } })).headers.get('access-control-allow-origin'), 'https://istalgan.uz');
  } finally { await multi.close(); await star.close(); }
});

test('standart holatda CORS yopiq (CORS_ORIGINS bo‘sh)', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('GET', '/health', { headers: { Origin: ORIGIN } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally { await t.close(); }
});

test('noma‘lum endpoint 404, noto‘g‘ri metod 405 — ikkalasi ham JSON', async () => {
  const t = await startTestApp();
  try {
    const nf = await t.api('GET', '/yoq-endpoint');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.code, 'not_found');
    const mna = await t.api('PUT', '/documents', { token: await t.tokenFor('admin'), body: {} });
    assert.equal(mna.status, 405);
    assert.equal(mna.body.code, 'method_not_allowed');
    assert.equal((await t.api('DELETE', '/auth/login')).status, 405);
  } finally { await t.close(); }
});

test('500 xatosida ichki ma‘lumot (stack, SQL) mijozga chiqmaydi, request_id beriladi', async () => {
  const t = await startTestApp();
  try {
    const token = await t.tokenFor('admin');
    t.db.close(); // bazani buzamiz
    const r = await t.api('GET', '/documents', { token });
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'Server xatosi');
    assert.equal(r.body.code, 'internal_error');
    assert.ok(r.body.request_id);
    assert.ok(!/at |sqlite|SELECT|database/i.test(r.text), r.text);
    assert.equal((await t.api('GET', '/health')).status, 503); // health holatni to‘g‘ri aytadi
  } finally { await t.close(); }
});

test('statik fayllar: faqat oq ro‘yxatdagilar beriladi, yo‘l bosib o‘tish (path traversal) ishlamaydi', async () => {
  const t = await startTestApp();
  try {
    const raw = (path) => new Promise((resolve, reject) => {
      const u = new URL(t.base);
      const req = request({ host: u.hostname, port: u.port, path, method: 'GET' }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, text: d }));
      });
      req.on('error', reject); req.end();
    });
    for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/public/app.js', '/src/server.js', '/package.json', '/.env', '/data/app.db', '/app.js/../../package.json']) {
      const r = await raw(p);
      assert.ok([404, 400].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!r.text.includes('"dependencies"') && !r.text.includes('createServer'), p);
    }
  } finally { await t.close(); }
});

test('veb-ilova: index.html, app.js va qat‘iy CSP (inline skript yo‘q)', async () => {
  const t = await startTestApp();
  try {
    const html = await fetch(`${t.base}/`);
    const text = await html.text();
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    const csp = html.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(text, /<script src="\/app\.js"><\/script>/);
    assert.doesNotMatch(text, /<script>[^<]/); // inline skript yo‘q

    const js = await fetch(`${t.base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    const code = await js.text();
    assert.ok(code.includes('/api/v1/'));
    assert.ok(!code.includes('window.fetch=')); // mock olib tashlangan

    assert.equal((await fetch(`${t.base}/index.html`)).status, 200);
    assert.equal((await fetch(`${t.base}/`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${t.base}/`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${t.base}/yoq`)).status, 404);
    const docs = await fetch(`${t.base}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get('content-security-policy'), /cdn\.jsdelivr\.net/);
    assert.equal((await fetch(`${t.base}/docs-init.js`)).status, 200);
  } finally { await t.close(); }
});

test('health: DB holatini ko‘rsatadi, token talab qilmaydi', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.db, 'ok');
    assert.equal(r.body.version, 'test');
    assert.ok(r.body.uptime_sec >= 0);
  } finally { await t.close(); }
});

test('OpenAPI: har bir marshrut hujjatda, himoyalangan endpointlarda bearerAuth bor', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('GET', '/openapi.json');
    assert.equal(r.status, 200);
    const doc = r.body;
    assert.equal(doc.openapi, '3.0.3');
    const ops = Object.entries(doc.paths).flatMap(([p, m]) => Object.entries(m).map(([method, op]) => ({ p, method, op })));
    assert.equal(ops.length, t.app.routes.length);
    for (const route of t.app.routes) {
      const p = route.path.replace(/:(\w+)/g, '{$1}');
      const op = doc.paths[p]?.[route.method.toLowerCase()];
      assert.ok(op, `${route.method} ${route.path} hujjatda yo‘q`);
      assert.equal(op.security.length, route.auth === false ? 0 : 1);
      assert.ok(op.summary && op.tags?.length);
    }
    assert.ok(doc.components.securitySchemes.bearerAuth);
    assert.ok(doc.paths['/documents'].post.requestBody.content['application/json'].schema.required.includes('number'));
  } finally { await t.close(); }
});

test('IP aniqlash: TRUST_PROXY o‘chiq bo‘lsa X-Forwarded-For e‘tiborga olinmaydi (rate limit aylanib o‘tilmaydi)', async () => {
  const t = await startTestApp({ env: { LOGIN_RATE_LIMIT_MAX: '2' } });
  try {
    const codes = [];
    for (let i = 0; i < 4; i += 1) {
      codes.push((await t.api('POST', '/auth/login', { body: { id: 'admin', password: 'x' }, headers: { 'X-Forwarded-For': `1.1.1.${i}` } })).status);
    }
    assert.deepEqual(codes, [401, 401, 429, 429]);
  } finally { await t.close(); }
});

test('IP aniqlash: TRUST_PROXY yoqilganda proksi qo‘shgan oxirgi IP ishlatiladi', async () => {
  const t = await startTestApp({ env: { LOGIN_RATE_LIMIT_MAX: '1', TRUST_PROXY: '1' } });
  try {
    const login = (xff) => t.api('POST', '/auth/login', { body: { id: 'admin', password: 'x' }, headers: { 'X-Forwarded-For': xff } }).then((r) => r.status);
    assert.equal(await login('9.9.9.9, 10.0.0.1'), 401);
    assert.equal(await login('8.8.8.8, 10.0.0.1'), 429); // mijoz soxta IP yozsa ham, oxirgi (proksi ko‘rgan) IP bir xil
    assert.equal(await login('8.8.8.8, 10.0.0.2'), 401); // boshqa haqiqiy IP — alohida hisob
  } finally { await t.close(); }
});
