import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { todayIn } from './dates.js';
import { createLogger } from './logger.js';
import { createRepo } from './repo.js';
import { seedBase, seedDemo } from './seed.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
config.warnings.forEach((w) => logger.warn(w));

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const db = await openDb(config);
const repo = createRepo(db);
await seedBase(repo, config);
if (config.seedDemo) {
  const n = await seedDemo(db, repo, { today: todayIn(config.tz) });
  if (n) logger.info('demo_seeded', { documents: n });
}

const app = createApp({ config, db, logger, version });
app.server.listen(config.port, config.host, () => {
  logger.info('server_started', {
    port: config.port,
    env: config.nodeEnv,
    db: config.tursoUrl ? 'turso' : config.dbPath,
    telegram: app.telegram.hasBot(),
    archive: app.telegram.hasArchive(),
    version,
  });
  app.telegram.setWebhook().catch((e) => {
    logger.warn('telegram_webhook_failed', { error: e?.message || String(e) });
  });
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('shutting_down', { signal });
  const timer = setTimeout(() => process.exit(1), 10_000).unref();
  await app.close();
  await db.close();
  clearTimeout(timer);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
