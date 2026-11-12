// Docker fayllarini statik tekshirish (Docker o'rnatilmagan muhitda ham ishlaydi).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const dockerfile = read('Dockerfile');
const compose = read('docker-compose.yml');

test('Dockerfile: ko‘p bosqichli (test → runtime) va testlar build paytida ishlaydi', () => {
  const stages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\w+)/gim)].map((m) => m[1]);
  assert.deepEqual(stages, ['test', 'runtime']);
  assert.match(dockerfile, /RUN npm test/);
  assert.match(dockerfile, /COPY --from=test \/app\/src/);
});

test('Dockerfile: kichik (alpine) image, aniq major versiya, root bo‘lmagan foydalanuvchi', () => {
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gim)].map((m) => m[1]);
  for (const f of froms) { assert.match(f, /^node:22-alpine$/); assert.ok(!f.endsWith(':latest')); }
  assert.match(dockerfile, /^USER node$/m);
  assert.ok(dockerfile.indexOf('USER node') > dockerfile.indexOf('chown -R node:node /app/data'));
  assert.match(dockerfile, /NODE_ENV=production/);
});

test('Dockerfile: HEALTHCHECK, VOLUME, CMD (exec shakli — SIGTERM to‘g‘ri yetib boradi)', () => {
  assert.match(dockerfile, /HEALTHCHECK[^\n]*\\\n\s*CMD \["node", "scripts\/healthcheck\.js"\]/);
  assert.match(dockerfile, /VOLUME \["\/app\/data"\]/);
  assert.match(dockerfile, /^CMD \["node",/m);
  assert.doesNotMatch(dockerfile, /^CMD [^\[]/m); // shell shakli emas
  assert.doesNotMatch(dockerfile, /npm (start|run)/); // npm PID 1 bo‘lib signalni yutmasin
});

test('Dockerfile: sirlar image ichiga yozilmaydi', () => {
  assert.doesNotMatch(dockerfile, /JWT_SECRET|ADMIN_PASSWORD|DEMO_PASSWORD/);
  assert.doesNotMatch(dockerfile, /COPY \.env/);
});

test('.dockerignore: .env, baza va git image ichiga tushmaydi', () => {
  const ign = read('.dockerignore').split(/\r?\n/).map((s) => s.trim());
  for (const x of ['.env', 'data', '.git', 'node_modules']) assert.ok(ign.includes(x), x);
  assert.ok(read('.gitignore').split(/\r?\n/).map((s) => s.trim()).includes('.env'));
});

test('compose: api servisi — healthcheck, volume, majburiy sirlar, cheklangan huquqlar', () => {
  assert.match(compose, /healthcheck:[\s\S]*scripts\/healthcheck\.js/);
  assert.match(compose, /app-data:\/app\/data/);
  assert.match(compose, /JWT_SECRET: \$\{JWT_SECRET:\?/); // berilmasa compose to‘xtaydi
  assert.match(compose, /ADMIN_PASSWORD: \$\{ADMIN_PASSWORD:\?/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /^volumes:\s*\n\s+app-data:/m);
});

test('compose: client servisi api sog‘lom bo‘lgandan keyin ishga tushadi va faqat "tools" profilida', () => {
  const client = compose.slice(compose.indexOf('  client:'));
  assert.match(client, /profiles: \["tools"\]/);
  assert.match(client, /condition: service_healthy/);
  assert.match(client, /API_URL: http:\/\/api:3000\/api\/v1/);
  assert.match(client, /scripts\/client-example\.js/);
});

test('compose: parollar/kalitlar faylda qattiq yozilmagan', () => {
  assert.doesNotMatch(compose, /(JWT_SECRET|ADMIN_PASSWORD|DEMO_PASSWORD|API_PASSWORD):\s*["']?[A-Za-z0-9]{6,}["']?\s*$/m);
});

test('.env.example: barcha kerakli o‘zgaruvchilar bor va haqiqiy sirlar yo‘q', () => {
  const env = read('.env.example');
  for (const k of ['JWT_SECRET', 'ADMIN_PASSWORD', 'CORS_ORIGINS', 'DB_PATH', 'ACCESS_TOKEN_TTL_SEC', 'REFRESH_TOKEN_TTL_SEC', 'TRUST_PROXY', 'SEED_DEMO', 'APP_TZ']) {
    assert.match(env, new RegExp(`^${k}=`, 'm'), k);
  }
  assert.match(env, /^JWT_SECRET=$/m);
  assert.match(env, /^ADMIN_PASSWORD=$/m);
});

test('healthcheck skripti va package.json mavjud; kerakli cloud/upload bog‘liqliklar ulangan', () => {
  assert.ok(existsSync(new URL('scripts/healthcheck.js', root)));
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['@libsql/client']);
  assert.ok(pkg.dependencies.multer);
  assert.equal(pkg.type, 'module');
  assert.match(pkg.engines.node, /22/);
  assert.match(pkg.scripts.test, /node --disable-warning=ExperimentalWarning --test/);
});
