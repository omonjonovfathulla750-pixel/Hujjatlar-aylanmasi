import { randomBytes } from 'node:crypto';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d = false) => (v == null || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const ROLES = ['admin', 'operator', 'viewer', 'user'];

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const prod = nodeEnv === 'production';
  const warnings = [];

  let jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    if (prod) throw new Error('JWT_SECRET majburiy (production)');
    jwtSecret = randomBytes(32).toString('hex');
    warnings.push('JWT_SECRET berilmagan: tasodifiy kalit ishlatildi, qayta ishga tushganda tokenlar yaroqsiz boʻladi');
  }
  if (prod && jwtSecret.length < 32) throw new Error('JWT_SECRET kamida 32 belgi boʻlishi kerak');

  let adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (prod) throw new Error('ADMIN_PASSWORD majburiy (production)');
    adminPassword = 'admin12345';
    warnings.push('ADMIN_PASSWORD berilmagan: dev uchun standart parol ishlatildi');
  }
  if (adminPassword.length < 8) throw new Error('ADMIN_PASSWORD kamida 8 belgi boʻlishi kerak');

  const seedDemo = bool(env.SEED_DEMO, false); // standart: demo ma'lumotlar yaratilmaydi
  let demoPassword = env.DEMO_PASSWORD || '';
  if (seedDemo && !demoPassword) {
    if (prod) throw new Error('SEED_DEMO yoqilgan bo‘lsa DEMO_PASSWORD majburiy (production)');
    demoPassword = 'demo12345';
    warnings.push('DEMO_PASSWORD berilmagan: dev uchun standart parol ishlatildi');
  }

  return {
    nodeEnv,
    prod,
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    dbPath: env.DB_PATH || './data/app.db',
    tz: env.APP_TZ || 'Asia/Tashkent',
    logLevel: env.LOG_LEVEL || 'info',
    jwtSecret,
    accessTtlSec: int(env.ACCESS_TOKEN_TTL_SEC, 900),
    refreshTtlSec: int(env.REFRESH_TOKEN_TTL_SEC, 7 * 86400),
    adminPassword,
    demoPassword,
    seedDemo,
    corsOrigins: list(env.CORS_ORIGINS),
    trustProxy: bool(env.TRUST_PROXY, false),
    bodyLimit: int(env.BODY_LIMIT_BYTES, 100_000),
    rateLimit: {
      windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
      max: int(env.RATE_LIMIT_MAX, 300),
      loginWindowMs: int(env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60_000),
      loginMax: int(env.LOGIN_RATE_LIMIT_MAX, 10),
    },
    warnings,
  };
}
