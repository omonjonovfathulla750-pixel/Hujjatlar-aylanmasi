// Haqiqiy server jarayoni (Docker konteyner ichida ishlaydigan buyruqning o'zi) bilan e2e.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const NODE = ['--disable-warning=ExperimentalWarning'];
const PORT = 3400 + Math.floor(Math.random() * 400);
const baseEnv = { PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: 'e'.repeat(48), ADMIN_PASSWORD: 'e2e-admin-pass', SEED_DEMO: 'true', DEMO_PASSWORD: 'e2e-demo-pass', PORT: String(PORT), LOG_LEVEL: 'info' };

async function waitHealthy(port, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok) return true; } catch { /* hali ishga tushmagan */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function start(env) {
  const child = spawn('node', [...NODE, 'src/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })));
  return { child, exited, logs: () => out };
}

test('server jarayoni: ishga tushadi, healthcheck skripti 0 qaytaradi, client skripti ma‘lumot oladi, SIGTERM da toza yopiladi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hujjat-e2e-'));
  const srv = start({ ...baseEnv, DB_PATH: join(dir, 'e2e.db') });
  try {
    assert.ok(await waitHealthy(PORT), `server ishga tushmadi:\n${srv.logs()}`);

    const hc = spawnSync('node', ['scripts/healthcheck.js'], { cwd: root, env: { PATH: process.env.PATH, PORT: String(PORT) } });
    assert.equal(hc.status, 0);

    const client = spawnSync('node', ['scripts/client-example.js'], {
      cwd: root, encoding: 'utf8',
      env: { PATH: process.env.PATH, API_URL: `http://127.0.0.1:${PORT}/api/v1`, API_ID: 'admin', API_PASSWORD: 'e2e-admin-pass' },
    });
    assert.equal(client.status, 0, client.stderr);
    assert.match(client.stdout, /Server holati: ok/);
    assert.match(client.stdout, /Token olindi: Bearer/);
    assert.match(client.stdout, /Hujjatlar: jami \d+ ta/);
    assert.match(client.stdout, /Statistika: jami \d+/);

    const wrong = spawnSync('node', ['scripts/client-example.js'], {
      cwd: root, encoding: 'utf8',
      env: { PATH: process.env.PATH, API_URL: `http://127.0.0.1:${PORT}/api/v1`, API_ID: 'admin', API_PASSWORD: 'notogri-parol' },
    });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /401/);

    srv.child.kill('SIGTERM');
    const { code } = await srv.exited;
    assert.equal(code, 0, srv.logs());
    assert.match(srv.logs(), /shutting_down/);
    // yopilgandan keyin healthcheck 1 qaytaradi
    const hc2 = spawnSync('node', ['scripts/healthcheck.js'], { cwd: root, env: { PATH: process.env.PATH, PORT: String(PORT) } });
    assert.equal(hc2.status, 1);
  } finally {
    srv.child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ma‘lumotlar server qayta ishga tushganda saqlanadi (volume simulyatsiyasi), demo ma‘lumot ikki marta yaratilmaydi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hujjat-e2e-'));
  const port = PORT + 1000;
  const env = { ...baseEnv, PORT: String(port), DB_PATH: join(dir, 'persist.db') };
  const login = async () => (await (await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'admin', password: 'e2e-admin-pass' }),
  })).json()).access_token;
  const list = async (tk, q = '') => (await (await fetch(`http://127.0.0.1:${port}/api/v1/documents?per_page=1${q}`, { headers: { Authorization: `Bearer ${tk}` } })).json());
  let total;
  try {
    let s = start(env);
    assert.ok(await waitHealthy(port), s.logs());
    let tk = await login();
    total = (await list(tk)).meta.total;
    const created = await fetch(`http://127.0.0.1:${port}/api/v1/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
      body: JSON.stringify({ number: 'PERSIST-1', type: 'Xat', org_id: 1, deadline: '2099-01-01', title: 'Saqlanishi kerak' }),
    });
    assert.equal(created.status, 201);
    s.child.kill('SIGTERM');
    await s.exited;

    s = start(env);
    assert.ok(await waitHealthy(port), s.logs());
    tk = await login();
    assert.equal((await list(tk)).meta.total, total + 1); // demo qayta yaratilmadi, yangi hujjat saqlangan
    assert.equal((await list(tk, '&q=PERSIST-1')).data[0].title, 'Saqlanishi kerak');
    s.child.kill('SIGTERM');
    await s.exited;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('production: JWT_SECRET/ADMIN_PASSWORD yo‘q bo‘lsa server ishga tushmaydi (noldan farqli chiqish kodi)', async () => {
  for (const missing of ['JWT_SECRET', 'ADMIN_PASSWORD']) {
    const env = { ...baseEnv, SEED_DEMO: 'false', DB_PATH: ':memory:' };
    delete env[missing];
    const r = spawnSync('node', [...NODE, 'src/server.js'], { cwd: root, env, encoding: 'utf8', timeout: 8000 });
    assert.notEqual(r.status, 0, missing);
    assert.match(r.stderr, new RegExp(missing));
  }
});

test('so‘rov loglari JSON, token va parol logga tushmaydi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hujjat-e2e-'));
  const port = PORT + 2000;
  const s = start({ ...baseEnv, PORT: String(port), DB_PATH: join(dir, 'log.db'), SEED_DEMO: 'false' });
  try {
    assert.ok(await waitHealthy(port), s.logs());
    const r = await (await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'admin', password: 'e2e-admin-pass' }),
    })).json();
    await fetch(`http://127.0.0.1:${port}/api/v1/documents?q=maxfiy-qidiruv`, { headers: { Authorization: `Bearer ${r.access_token}` } });
    s.child.kill('SIGTERM');
    await s.exited;
    const logs = s.logs();
    const lines = logs.trim().split('\n').map((l) => JSON.parse(l));
    const reqs = lines.filter((l) => l.msg === 'request');
    assert.ok(reqs.length >= 3);
    assert.ok(reqs.every((l) => l.reqId && l.method && l.path && l.status && typeof l.ms === 'number'));
    assert.ok(reqs.some((l) => l.path === '/api/v1/documents' && l.user === 9)); // kim so‘ragani yoziladi
    assert.ok(!logs.includes('e2e-admin-pass'));
    assert.ok(!logs.includes(r.access_token) && !logs.includes(r.refresh_token));
    assert.ok(!logs.includes('maxfiy-qidiruv')); // query string yozilmaydi
  } finally { s.child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});
