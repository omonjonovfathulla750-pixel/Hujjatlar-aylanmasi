import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startTestApp } from '../helpers.js';

test('login: muvaffaqiyatli kirish token juftligini va foydalanuvchini qaytaradi', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('POST', '/auth/login', { body: { id: 'admin', password: 'adminpass1' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.token_type, 'Bearer');
    assert.equal(r.body.expires_in, 900);
    assert.match(r.body.access_token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.notEqual(r.body.access_token, r.body.refresh_token);
    assert.equal(r.body.user.role, 'admin');
    assert.equal(r.body.user.code, 'admin');
    assert.ok(!r.text.includes('password_hash') && !r.text.includes('scrypt$'));
  } finally { await t.close(); }
});

test('login: noto‘g‘ri ID/parol — 401 va bir xil xabar (foydalanuvchi mavjudligi sezilmaydi)', async () => {
  const t = await startTestApp();
  try {
    const a = await t.api('POST', '/auth/login', { body: { id: 'admin', password: 'xato-parol' } });
    const b = await t.api('POST', '/auth/login', { body: { id: 'mavjud-emas', password: 'xato-parol' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error);
    assert.equal(a.body.code, 'invalid_credentials');
  } finally { await t.close(); }
});

test('login: SQL-inyeksiya urinishi muvaffaqiyatsiz', async () => {
  const t = await startTestApp();
  try {
    for (const id of ["' OR 1=1 --", "admin' --", '" OR ""="']) {
      const r = await t.api('POST', '/auth/login', { body: { id, password: "' OR '1'='1" } });
      assert.equal(r.status, 401, id);
    }
  } finally { await t.close(); }
});

test('login: tana tekshiruvi (maydonlar, JSON, Content-Type)', async () => {
  const t = await startTestApp();
  try {
    assert.equal((await t.api('POST', '/auth/login', { body: {} })).status, 422);
    assert.equal((await t.api('POST', '/auth/login', { body: { id: 'admin' } })).status, 422);
    assert.equal((await t.api('POST', '/auth/login', { body: { id: 'a', password: 'b', role: 'admin' } })).status, 422);
    assert.equal((await t.api('POST', '/auth/login', { body: { id: 5, password: 'b' } })).status, 422);
    assert.equal((await t.api('POST', '/auth/login', { body: { id: 'a'.repeat(65), password: 'b' } })).status, 422);
    assert.equal((await t.api('POST', '/auth/login', { raw: '{bu json emas', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.equal((await t.api('POST', '/auth/login', { raw: 'id=admin', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await t.api('POST', '/auth/login', { raw: '[]', headers: { 'Content-Type': 'application/json' } })).status, 422);
  } finally { await t.close(); }
});

test('himoyalangan endpoint: tokensiz 401 (missing_token + WWW-Authenticate), yaroqsiz token 401', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('GET', '/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'missing_token');
    assert.equal(r.headers.get('www-authenticate'), 'Bearer');
    for (const h of ['Bearer yaroqsiz', 'Bearer a.b.c', 'Basic YWRtaW46YWRtaW4=', 'Bearer', 'token-faqat']) {
      const x = await t.api('GET', '/auth/me', { headers: { Authorization: h } });
      assert.equal(x.status, 401, h);
    }
  } finally { await t.close(); }
});

test('me: token egasini qaytaradi', async () => {
  const t = await startTestApp();
  try {
    const r = await t.api('GET', '/auth/me', { token: await t.tokenFor('U001') });
    assert.equal(r.status, 200);
    assert.equal(r.body.role, 'user');
    assert.equal(r.body.code, undefined); // admin bo‘lmagani uchun ID kodi ko‘rinmaydi
  } finally { await t.close(); }
});

test('access token muddati tugaydi (15 daqiqa), refresh bilan davom etiladi', async () => {
  const t = await startTestApp();
  try {
    const l = await t.login('admin');
    assert.equal((await t.api('GET', '/auth/me', { token: l.access_token })).status, 200);
    t.clock.t = new Date(t.clock.t.getTime() + 901_000);
    const expired = await t.api('GET', '/auth/me', { token: l.access_token });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.code, 'token_expired');
    const r = await t.api('POST', '/auth/refresh', { body: { refresh_token: l.refresh_token } });
    assert.equal(r.status, 200);
    assert.equal((await t.api('GET', '/auth/me', { token: r.body.access_token })).status, 200);
  } finally { await t.close(); }
});

test('refresh: rotation, eski tokenni qayta ishlatish barcha tokenlarni bekor qiladi', async () => {
  const t = await startTestApp();
  try {
    const l = await t.login('U001');
    const r1 = await t.api('POST', '/auth/refresh', { body: { refresh_token: l.refresh_token } });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.body.refresh_token, l.refresh_token);
    const reuse = await t.api('POST', '/auth/refresh', { body: { refresh_token: l.refresh_token } });
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.code, 'token_reuse');
    const after = await t.api('POST', '/auth/refresh', { body: { refresh_token: r1.body.refresh_token } });
    assert.equal(after.status, 401); // yangisi ham bekor qilingan
  } finally { await t.close(); }
});

test('refresh: access token refresh sifatida, chiqindi va bo‘sh qiymat rad etiladi', async () => {
  const t = await startTestApp();
  try {
    const l = await t.login('admin');
    assert.equal((await t.api('POST', '/auth/refresh', { body: { refresh_token: l.access_token } })).status, 401);
    assert.equal((await t.api('POST', '/auth/refresh', { body: { refresh_token: 'chiqindi' } })).status, 401);
    assert.equal((await t.api('POST', '/auth/refresh', { body: {} })).status, 422);
    // refresh token access sifatida ishlamaydi
    assert.equal((await t.api('GET', '/auth/me', { token: l.refresh_token })).status, 401);
  } finally { await t.close(); }
});

test('logout: refresh token bekor qilinadi', async () => {
  const t = await startTestApp();
  try {
    const l = await t.login('admin');
    const out = await t.api('POST', '/auth/logout', { body: { refresh_token: l.refresh_token } });
    assert.equal(out.status, 200);
    assert.equal((await t.api('POST', '/auth/refresh', { body: { refresh_token: l.refresh_token } })).status, 401);
    assert.equal((await t.api('POST', '/auth/logout', { body: {} })).status, 200); // tokensiz ham xato bermaydi
  } finally { await t.close(); }
});

test('faol bo‘lmay qolgan foydalanuvchining tokenlari darhol ishlamay qoladi; rol o‘zgarishi darhol kuchga kiradi', async () => {
  const t = await startTestApp();
  try {
    const l = await t.login('U001');
    assert.equal((await t.api('GET', '/documents', { token: l.access_token })).status, 200);
    await t.repo.setRole((await t.repo.userByCode('U001')).id, 'operator'); // tokenda hali 'user' yozilgan
    const create = await t.api('POST', '/documents', { token: l.access_token, body: { number: 'R-1', type: 'Xat', org_id: 1, deadline: '2026-12-01', title: 't' } });
    assert.equal(create.status, 201); // rol DB'dan olinadi, tokendan emas
    await t.db.run("UPDATE users SET active = 0 WHERE code = 'U001'");
    assert.equal((await t.api('GET', '/documents', { token: l.access_token })).status, 401);
    assert.equal((await t.api('POST', '/auth/refresh', { body: { refresh_token: l.refresh_token } })).status, 401);
  } finally { await t.close(); }
});

test('boshqa kalit bilan imzolangan va "admin" roli yozilgan soxta token rad etiladi', async () => {
  const t = await startTestApp();
  try {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 9, role: 'admin', typ: 'access', exp: Math.floor(Date.now() / 1000) + 9999 })).toString('base64url');
    const sig = createHmac('sha256', 'hujum-qiluvchi-kaliti').update(`${head}.${body}`).digest('base64url');
    const r = await t.api('GET', '/audit', { token: `${head}.${body}.${sig}` });
    assert.equal(r.status, 401);
  } finally { await t.close(); }
});

test('login rate limit: bir ID uchun urinishlar cheklanadi (429 + Retry-After), boshqa ID ta‘sirlanmaydi', async () => {
  const t = await startTestApp({ env: { LOGIN_RATE_LIMIT_MAX: '3' } });
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await t.api('POST', '/auth/login', { body: { id: 'admin', password: 'xato' } })).status, 401);
    }
    const blocked = await t.api('POST', '/auth/login', { body: { id: 'admin', password: 'adminpass1' } }); // to‘g‘ri parol ham bloklanadi
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.equal(blocked.body.code, 'rate_limited');
    assert.equal((await t.api('POST', '/auth/login', { body: { id: 'U001', password: 'demopass1' } })).status, 200);
  } finally { await t.close(); }
});

test('login rate limit: bitta IP dan ko‘p turli ID sinash ham to‘xtatiladi', async () => {
  const t = await startTestApp({ env: { LOGIN_RATE_LIMIT_MAX: '2' } }); // IP chegarasi = 6
  try {
    const codes = [];
    for (let i = 0; i < 8; i += 1) codes.push((await t.api('POST', '/auth/login', { body: { id: `X${i}`, password: 'p' } })).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 429, 429]);
  } finally { await t.close(); }
});

test('umumiy rate limit: chegaradan keyin 429, sarlavhalarda qolgan limit ko‘rinadi', async () => {
  const t = await startTestApp({ env: { RATE_LIMIT_MAX: '4' } });
  try {
    const first = await t.api('GET', '/health');
    assert.equal(first.headers.get('x-ratelimit-limit'), '4');
    assert.equal(first.headers.get('x-ratelimit-remaining'), '3');
    for (let i = 0; i < 3; i += 1) assert.equal((await t.api('GET', '/health')).status, 200);
    const r = await t.api('GET', '/health');
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
  } finally { await t.close(); }
});
