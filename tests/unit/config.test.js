import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ROLES } from '../../src/config.js';

const prodEnv = { NODE_ENV: 'production', JWT_SECRET: 'k'.repeat(32), ADMIN_PASSWORD: 'parol1234' };

test('production: JWT_SECRET va ADMIN_PASSWORD majburiy', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'parol1234' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'k'.repeat(32) }), /ADMIN_PASSWORD/);
  assert.throws(() => loadConfig({ ...prodEnv, JWT_SECRET: 'qisqa' }), /32/);
  assert.throws(() => loadConfig({ ...prodEnv, ADMIN_PASSWORD: '123' }), /8/);
});

test('production: SEED_DEMO yoqilsa DEMO_PASSWORD majburiy', () => {
  assert.throws(() => loadConfig({ ...prodEnv, SEED_DEMO: 'true' }), /DEMO_PASSWORD/);
  const c = loadConfig({ ...prodEnv, SEED_DEMO: 'true', DEMO_PASSWORD: 'demo-parol' });
  assert.equal(c.seedDemo, true);
});

test('production standart bo‘yicha demo ma‘lumotsiz, ogohlantirishsiz', () => {
  const c = loadConfig(prodEnv);
  assert.equal(c.prod, true);
  assert.equal(c.seedDemo, false);
  assert.deepEqual(c.warnings, []);
});

test('development: kalit va parol avtomatik, ogohlantirish bilan (demo o‘chiq)', () => {
  const c = loadConfig({});
  assert.equal(c.prod, false);
  assert.equal(c.jwtSecret.length, 64);
  assert.equal(c.seedDemo, false);
  assert.ok(c.warnings.length >= 2);
  assert.notEqual(loadConfig({}).jwtSecret, c.jwtSecret); // har safar tasodifiy
});

test('qiymatlar to‘g‘ri o‘qiladi (raqam, ro‘yxat, mantiqiy)', () => {
  const c = loadConfig({ ...prodEnv, PORT: '8080', CORS_ORIGINS: ' https://a.uz , https://b.uz ,', TRUST_PROXY: 'true', RATE_LIMIT_MAX: 'abc', BODY_LIMIT_BYTES: '5' });
  assert.equal(c.port, 8080);
  assert.deepEqual(c.corsOrigins, ['https://a.uz', 'https://b.uz']);
  assert.equal(c.trustProxy, true);
  assert.equal(c.rateLimit.max, 300); // noto‘g‘ri qiymat → standart
  assert.equal(c.bodyLimit, 5);
  assert.deepEqual(ROLES, ['admin', 'operator', 'viewer', 'user']);
});
