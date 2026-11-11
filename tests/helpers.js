import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createRepo } from '../src/repo.js';
import { seedBase, seedDemo } from '../src/seed.js';
import { todayIn } from '../src/dates.js';

export const ADMIN_PASSWORD = 'adminpass1';
export const DEMO_PASSWORD = 'demopass1';

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'j'.repeat(48),
    ADMIN_PASSWORD,
    DEMO_PASSWORD,
    SEED_DEMO: 'false',
    RATE_LIMIT_MAX: '100000',
    LOGIN_RATE_LIMIT_MAX: '100000',
    APP_TZ: 'Asia/Tashkent',
    ...overrides,
  });
}

// Test serveri: xotiradagi SQLite + tasodifiy port + boshqariladigan soat.
export async function startTestApp({ env = {}, demo = false, startAt = '2026-11-07T08:00:00Z', realClock = false } = {}) {
  const config = testConfig(env);
  const db = openDb(':memory:');
  const repo = createRepo(db);
  seedBase(repo, config);
  const clock = { t: new Date(startAt) };
  const now = realClock ? () => new Date() : () => clock.t;
  if (demo) seedDemo(db, repo, { today: todayIn(config.tz, now()) });
  const app = createApp({ config, db, now, version: 'test' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  async function api(method, path, { token, body, headers = {}, raw } = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...(body !== undefined && raw === undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* json emas */ }
    return { status: res.status, body: json, headers: res.headers, text };
  }

  const tokenCache = new Map();
  async function login(code = 'admin', password) {
    const pw = password ?? (code === 'admin' ? ADMIN_PASSWORD : DEMO_PASSWORD);
    const r = await api('POST', '/auth/login', { body: { id: code, password: pw } });
    if (r.status !== 200) throw new Error(`login ${code} -> ${r.status} ${r.text}`);
    return r.body;
  }
  // Tezlik uchun token keshlanadi (scrypt sekin)
  async function tokenFor(code = 'admin') {
    if (!tokenCache.has(code)) tokenCache.set(code, (await login(code)).access_token);
    return tokenCache.get(code);
  }

  return {
    app, db, repo, config, base, clock, api, login, tokenFor,
    async close() { await app.close(); try { db.close(); } catch { /* allaqachon yopilgan */ } },
  };
}

// Rollar: U001 user, U002 operator, U003 viewer, U004 user, admin
export function setupRoles(t) {
  t.repo.setRole(t.repo.userByCode('U002').id, 'operator');
  t.repo.setRole(t.repo.userByCode('U003').id, 'viewer');
}

export const id = (t, code) => t.repo.userByCode(code).id;

export const newDoc = (over = {}) => ({
  number: `N-${Math.random().toString(36).slice(2, 8)}`,
  type: 'Xat', org_id: 1, deadline: '2026-12-01', title: 'Sinov hujjati', ...over,
});
