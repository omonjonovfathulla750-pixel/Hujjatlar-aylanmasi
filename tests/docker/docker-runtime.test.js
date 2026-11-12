// Haqiqiy Docker testi: faqat `docker` mavjud bo'lsa ishlaydi, aks holda SKIP (yolg'on "o'tdi" bermaydi).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const hasCli = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const hasDaemon = hasCli && spawnSync('docker', ['info'], { encoding: 'utf8' }).status === 0;
const enabled = hasDaemon && process.env.SKIP_DOCKER_RUNTIME !== '1';
const skip = enabled ? false : 'docker compose/daemon ishlamayapti (yoki SKIP_DOCKER_RUNTIME=1) — bu testni Docker ishlayotgan mashinada ishga tushiring';

const env = { ...process.env, JWT_SECRET: 'd'.repeat(48), ADMIN_PASSWORD: 'docker-test-pass', SEED_DEMO: 'true', DEMO_PASSWORD: 'docker-demo-pass', PORT: '3999', COMPOSE_PROJECT_NAME: 'hujjat-test' };
const dc = (...args) => spawnSync('docker', ['compose', ...args], { cwd: new URL('../../', import.meta.url), env, encoding: 'utf8' });

test('docker compose up --wait: servis sog‘lom, token bilan ma‘lumot olinadi, client konteyneri ishlaydi', { skip, timeout: 600_000 }, async (t) => {
  t.after(() => dc('down', '-v'));
  const up = dc('up', '-d', '--build', '--wait');
  assert.equal(up.status, 0, up.stderr);

  const health = await (await fetch('http://127.0.0.1:3999/api/v1/health')).json();
  assert.equal(health.status, 'ok');

  assert.equal((await fetch('http://127.0.0.1:3999/api/v1/documents')).status, 401);
  const login = await (await fetch('http://127.0.0.1:3999/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'admin', password: 'docker-test-pass' }),
  })).json();
  const docs = await fetch('http://127.0.0.1:3999/api/v1/documents?per_page=1', { headers: { Authorization: `Bearer ${login.access_token}` } });
  assert.equal(docs.status, 200);

  const client = dc('--profile', 'tools', 'run', '--rm', '-e', 'API_PASSWORD=docker-test-pass', 'client');
  assert.equal(client.status, 0, client.stderr);
  assert.match(client.stdout, /Hujjatlar: jami \d+ ta/);

  // Konteyner qayta yaratilganda ma'lumotlar saqlanib qoladi (volume)
  assert.equal(dc('restart', 'api').status, 0);
  assert.equal(dc('up', '-d', '--wait').status, 0);
  const again = await fetch('http://127.0.0.1:3999/api/v1/documents?per_page=1', { headers: { Authorization: `Bearer ${login.access_token}` } });
  assert.ok([200, 401].includes(again.status));
});
