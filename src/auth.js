// JWT (HS256) va parol heshlash — tashqi kutubxonasiz, faqat node:crypto.
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError, unauthorized } from './errors.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

function hmac(data, secret) {
  return createHmac('sha256', secret).update(data).digest();
}

export function signJwt(payload, secret, { ttlSec, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const body = { ...payload, iat, exp: iat + ttlSec };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  return `${data}.${b64u(hmac(data, secret))}`;
}

export function verifyJwt(token, secret, { typ, now = Date.now() } = {}) {
  const bad = (code = 'invalid_token', msg = 'Token yaroqsiz') => unauthorized(msg, { code });
  if (typeof token !== 'string') throw bad();
  const parts = token.split('.');
  if (parts.length !== 3) throw bad();
  const [h, p, s] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(fromB64u(h).toString('utf8'));
    payload = JSON.parse(fromB64u(p).toString('utf8'));
  } catch {
    throw bad();
  }
  // alg=none va boshqa algoritmlarni rad etamiz
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') throw bad();

  const expected = hmac(`${h}.${p}`, secret);
  const given = fromB64u(s);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();

  if (!payload || typeof payload.exp !== 'number' || payload.exp <= Math.floor(now / 1000)) {
    throw bad('token_expired', 'Token muddati tugagan');
  }
  if (typ && payload.typ !== typ) throw bad();
  return payload;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Foydalanuvchi mavjud bo'lmaganda ham bir xil vaqt sarflash uchun (timing hujumiga qarshi)
const DUMMY_HASH = hashPassword('dummy-password-for-timing');
export const burnPasswordCheck = (password) => verifyPassword(password, DUMMY_HASH);

export function createTokenService({ db, config, now = () => Date.now() }) {
  const secret = config.jwtSecret;

  function issue(user) {
    const t = now();
    const jti = randomUUID();
    const access = signJwt({ sub: user.id, role: user.role, typ: 'access' }, secret, { ttlSec: config.accessTtlSec, now: t });
    const refresh = signJwt({ sub: user.id, typ: 'refresh', jti }, secret, { ttlSec: config.refreshTtlSec, now: t });
    db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(Math.floor(t / 1000));
    db.prepare('INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?,?,?)')
      .run(jti, user.id, Math.floor(t / 1000) + config.refreshTtlSec);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: config.accessTtlSec };
  }

  function verifyAccess(token) {
    return verifyJwt(token, secret, { typ: 'access', now: now() });
  }

  // Refresh tokenni almashtiradi (rotation). Allaqachon ishlatilgan token qayta kelsa —
  // o'g'irlangan deb hisoblab, foydalanuvchining barcha refresh tokenlari bekor qilinadi.
  function rotate(refreshToken, loadUser) {
    const p = verifyJwt(refreshToken, secret, { typ: 'refresh', now: now() });
    const row = db.prepare('SELECT jti, user_id, revoked FROM refresh_tokens WHERE jti = ?').get(p.jti);
    if (!row) throw unauthorized('Refresh token topilmadi', { code: 'invalid_token' });
    if (row.revoked) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(row.user_id);
      throw unauthorized('Refresh token qayta ishlatilgan; qaytadan kiring', { code: 'token_reuse' });
    }
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?').run(p.jti);
    const user = loadUser(row.user_id);
    if (!user || !user.active) throw unauthorized('Foydalanuvchi faol emas', { code: 'invalid_token' });
    return { user, tokens: issue(user) };
  }

  function revoke(refreshToken) {
    try {
      const p = verifyJwt(refreshToken, secret, { typ: 'refresh', now: now() });
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?').run(p.jti);
      return true;
    } catch (e) {
      if (e instanceof HttpError) return false;
      throw e;
    }
  }

  function revokeAllForUser(userId) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  }

  return { issue, verifyAccess, rotate, revoke, revokeAllForUser };
}
