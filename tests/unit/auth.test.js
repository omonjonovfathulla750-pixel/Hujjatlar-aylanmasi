import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { burnPasswordCheck, createTokenService, hashPassword, signJwt, verifyJwt, verifyPassword } from '../../src/auth.js';
import { openDb } from '../../src/db.js';

const SECRET = 's'.repeat(40);
const NOW = Date.UTC(2026, 10, 7, 8, 0, 0);
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('JWT: imzolash va tekshirish', () => {
  const t = signJwt({ sub: 1, typ: 'access' }, SECRET, { ttlSec: 60, now: NOW });
  const p = verifyJwt(t, SECRET, { typ: 'access', now: NOW + 1000 });
  assert.equal(p.sub, 1);
  assert.equal(p.exp - p.iat, 60);
});

test('JWT: muddati tugagan token rad etiladi', () => {
  const t = signJwt({ sub: 1, typ: 'access' }, SECRET, { ttlSec: 60, now: NOW });
  assert.equal(code(() => verifyJwt(t, SECRET, { now: NOW + 61_000 })), 'token_expired');
});

test('JWT: boshqa kalit, o‘zgartirilgan payload, noto‘g‘ri tur va chiqindi rad etiladi', () => {
  const t = signJwt({ sub: 1, typ: 'access', role: 'user' }, SECRET, { ttlSec: 60, now: NOW });
  assert.equal(code(() => verifyJwt(t, 'x'.repeat(40), { now: NOW })), 'invalid_token');
  const [h, p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), role: 'admin' })).toString('base64url');
  assert.equal(code(() => verifyJwt(`${h}.${forged}.${s}`, SECRET, { now: NOW })), 'invalid_token');
  assert.equal(code(() => verifyJwt(t, SECRET, { typ: 'refresh', now: NOW })), 'invalid_token');
  for (const bad of ['', 'a.b', 'a.b.c', null, undefined, 123, 'a.b.c.d']) {
    assert.equal(code(() => verifyJwt(bad, SECRET, { now: NOW })), 'invalid_token', String(bad));
  }
});

test('JWT: alg=none hujumi rad etiladi', () => {
  const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 9, typ: 'access', exp: Math.floor(NOW / 1000) + 999 })).toString('base64url');
  assert.equal(code(() => verifyJwt(`${head}.${body}.`, SECRET, { now: NOW })), 'invalid_token');
  // to'g'ri imzo, lekin HS512 deb e'lon qilingan header ham rad etiladi
  const h2 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(`${h2}.${body}`).digest('base64url');
  assert.equal(code(() => verifyJwt(`${h2}.${body}.${sig}`, SECRET, { now: NOW })), 'invalid_token');
});

test('parol: hesh tasodifiy tuz bilan, tekshiruv to‘g‘ri/noto‘g‘ri', () => {
  const a = hashPassword('maxfiy-parol');
  const b = hashPassword('maxfiy-parol');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword('maxfiy-parol', a), true);
  assert.equal(verifyPassword('boshqa', a), false);
  for (const bad of [null, undefined, '', 'plain', 'md5$a$b']) assert.equal(verifyPassword('x', bad), false);
  assert.equal(verifyPassword(null, a), false);
  assert.equal(burnPasswordCheck('x'), false);
});

async function tokenEnv() {
  const db = await openDb(':memory:');
  await db.run("INSERT INTO organizations (name) VALUES ('O')");
  await db.run("INSERT INTO users (name, org_id, role, code) VALUES ('U', 1, 'user', 'U1')");
  const clock = { t: NOW };
  const svc = createTokenService({ db, config: { jwtSecret: SECRET, accessTtlSec: 900, refreshTtlSec: 3600 }, now: () => clock.t });
  const user = { id: 1, role: 'user', active: 1 };
  return { db, svc, clock, user, load: (id) => (id === 1 ? user : null) };
}

test('token xizmati: issue → verifyAccess', async () => {
  const { svc, user } = await tokenEnv();
  const t = await svc.issue(user);
  assert.equal(t.token_type, 'Bearer');
  assert.equal(t.expires_in, 900);
  assert.equal(svc.verifyAccess(t.access_token).sub, 1);
  assert.equal(codeSync(() => svc.verifyAccess(t.refresh_token)), 'invalid_token'); // refresh access sifatida ishlamaydi
});

test('token xizmati: refresh rotation eski tokenni bekor qiladi', async () => {
  const { svc, user, load } = await tokenEnv();
  const t1 = await svc.issue(user);
  const { tokens: t2 } = await svc.rotate(t1.refresh_token, load);
  assert.notEqual(t2.refresh_token, t1.refresh_token);
  assert.equal(svc.verifyAccess(t2.access_token).sub, 1);
});

test('token xizmati: ishlatilgan refresh qayta kelsa — barcha tokenlar bekor (o‘g‘irlik aniqlash)', async () => {
  const { svc, user, load } = await tokenEnv();
  const t1 = await svc.issue(user);
  const { tokens: t2 } = await svc.rotate(t1.refresh_token, load);
  assert.equal(await code(() => svc.rotate(t1.refresh_token, load)), 'token_reuse');
  assert.equal(await code(() => svc.rotate(t2.refresh_token, load)), 'token_reuse'); // yangisi ham bekor bo‘lgan
});

test('token xizmati: logout, muddat va faol bo‘lmagan foydalanuvchi', async () => {
  const { svc, user, load, clock } = await tokenEnv();
  const t = await svc.issue(user);
  assert.equal(await svc.revoke(t.refresh_token), true);
  assert.equal(await code(() => svc.rotate(t.refresh_token, load)), 'token_reuse');
  assert.equal(await svc.revoke('garbage'), false);

  const t2 = await svc.issue(user);
  assert.equal(await code(() => svc.rotate(t2.refresh_token, () => ({ ...user, active: 0 }))), 'invalid_token');
  const t3 = await svc.issue(user);
  clock.t += 3601_000;
  assert.equal(await code(() => svc.rotate(t3.refresh_token, load)), 'token_expired');
});

test('token xizmati: bazada yo‘q jti rad etiladi; revokeAllForUser ishlaydi', async () => {
  const { svc, user, load, db } = await tokenEnv();
  const t = await svc.issue(user);
  await db.run('DELETE FROM refresh_tokens');
  assert.equal(await code(() => svc.rotate(t.refresh_token, load)), 'invalid_token');
  const t2 = await svc.issue(user);
  await svc.revokeAllForUser(1);
  assert.equal(await code(() => svc.rotate(t2.refresh_token, load)), 'token_reuse');
});
