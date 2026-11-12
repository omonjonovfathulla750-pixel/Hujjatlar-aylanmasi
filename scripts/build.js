// Loyiha build tekshiruvi: Node versiyasi, JS sintaksisi, statik fayllar, in-memory API tekshiruvi va build/ papkasini yaratish.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createRepo } from '../src/repo.js';
import { seedBase } from '../src/seed.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function collectJs(dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  const files = [];
  for (const ent of readdirSync(full, { withFileTypes: true })) {
    const rel = join(dir, ent.name);
    if (ent.isDirectory()) files.push(...collectJs(rel));
    else if (ent.name.endsWith('.js')) files.push(rel);
  }
  return files;
}

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  throw new Error(`Node.js >= 22.13 talab qilinadi (joriy: ${process.versions.node})`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const asset of ['public/index.html', 'public/app.js', 'public/docs.html', 'public/docs-init.js', 'src/server.js']) {
  const p = join(root, asset);
  if (!existsSync(p) || !readFileSync(p, 'utf8').trim()) {
    throw new Error(`Kerakli fayl topilmadi yoki bo‘sh: ${asset}`);
  }
}

const jsFiles = [...collectJs('src'), ...collectJs('scripts'), ...collectJs('public')];
for (const rel of jsFiles) {
  execFileSync(process.execPath, ['--check', join(root, rel)], { stdio: 'pipe' });
}

const config = loadConfig({ ...process.env, NODE_ENV: 'development', DB_PATH: ':memory:', SEED_DEMO: 'false' });
const db = openDb(':memory:');
try {
  seedBase(createRepo(db), config);
  const app = createApp({ config, db, version: pkg.version });
  if (!app.routes.length || !Object.keys(app.openapi.paths).length) {
    throw new Error('Marshrutlar yoki OpenAPI sxemasi yaratilmadi');
  }
} finally {
  db.close();
}

const buildDir = join(root, 'build');
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
cpSync(join(root, 'public'), join(buildDir, 'public'), { recursive: true });
cpSync(join(root, 'src'), join(buildDir, 'src'), { recursive: true });
cpSync(join(root, 'package.json'), join(buildDir, 'package.json'));
if (existsSync(join(root, 'render.yaml'))) cpSync(join(root, 'render.yaml'), join(buildDir, 'render.yaml'));

console.log(`Build tayyor: v${pkg.version} | ${jsFiles.length} ta JS fayl, statik fayllar va API tekshirildi -> build/ papkasi yaratildi.`);
