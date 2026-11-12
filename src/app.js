import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import multer from 'multer';
import { createTokenService } from './auth.js';
import { HttpError, Reply, badRequest, forbidden, notFound, unauthorized, unprocessable } from './errors.js';
import { createLogger } from './logger.js';
import { buildOpenApi } from './openapi.js';
import { createRateLimiter } from './rateLimit.js';
import { createRepo } from './repo.js';
import { Router } from './router.js';
import { buildRoutes } from './routes.js';
import { createService } from './service.js';
import { createTelegramService } from './telegram.js';
import { validateOrThrow } from './validate.js';

const API_PREFIX = '/api/v1';
const PUBLIC_DIR = new URL('../public/', import.meta.url);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8', 'app'],
  '/index.html': ['index.html', 'text/html; charset=utf-8', 'app'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8', 'app'],
  '/docs': ['docs.html', 'text/html; charset=utf-8', 'docs'],
  '/docs-init.js': ['docs-init.js', 'text/javascript; charset=utf-8', 'docs'],
};

const CSP = {
  app: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  // Swagger UI CDN'dan yuklanadi (cdn.jsdelivr.net)
  docs: "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  api: "default-src 'none'; frame-ancestors 'none'",
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'Soʻrov hajmi juda katta'));
      return;
    }
    let size = 0;
    let settled = false;
    const chunks = [];
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) { settled = true; reject(new HttpError(413, 'Soʻrov hajmi juda katta')); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file');

function runMemoryUpload(req, res) {
  return new Promise((resolve, reject) => {
    memoryUpload(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') {
        reject(unprocessable('Fayl hajmi 10 MB dan oshmasligi kerak'));
        return;
      }
      reject(badRequest(err.message || 'Fayl yuklash xatosi'));
    });
  });
}

export function createApp({ config, db, logger = createLogger({ level: 'silent' }), now = () => new Date(), version = '0.0.0', telegram: customTelegram = null }) {
  const repo = createRepo(db);
  const tokens = createTokenService({ db, config, now: () => now().getTime() });
  const telegram = customTelegram || createTelegramService({ config, logger });
  const svc = createService({ db, repo, tokens, config, now, telegram });
  const routes = buildRoutes({ svc, repo, version });
  const router = new Router();
  routes.forEach((r) => router.add(r));
  const openapi = buildOpenApi(router.routes, { version });

  const rl = config.rateLimit;
  const generalLimiter = createRateLimiter({ windowMs: rl.windowMs, max: rl.max });
  const loginIdLimiter = createRateLimiter({ windowMs: rl.loginWindowMs, max: rl.loginMax });
  const loginIpLimiter = createRateLimiter({ windowMs: rl.loginWindowMs, max: rl.loginMax * 3 });

  const clientIp = (req) => {
    if (config.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1]; // ishonchli proksi qo'shgan oxirgi yozuv
    }
    return req.socket.remoteAddress || 'unknown';
  };

  function limitOrThrow(limiter, key, res) {
    const r = limiter.hit(key);
    if (res) {
      res.setHeader('X-RateLimit-Limit', r.limit);
      res.setHeader('X-RateLimit-Remaining', r.remaining);
    }
    if (!r.allowed) {
      res.setHeader('Retry-After', r.retryAfterSec);
      throw new HttpError(429, 'Juda koʻp soʻrov. Birozdan keyin urinib koʻring', { code: 'rate_limited' });
    }
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return;
    res.setHeader('Vary', 'Origin');
    if (!(config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,Retry-After,Content-Disposition');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  function send(res, status, body, extra = {}, raw = false) {
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    if (status === 204 || body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    if (raw) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, {
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      });
      res.end(buf);
      return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  }

  async function handleApi(req, res, url, state) {
    const method = req.method;
    const path = url.pathname.slice(API_PREFIX.length) || '/';
    limitOrThrow(generalLimiter, state.ip, res);

    if (method === 'GET' && path === '/openapi.json') return send(res, 200, openapi);
    const vm = /^\/attachments\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
    if ((method === 'GET' || method === 'HEAD') && vm) {
      const r = await svc.serveViewTicket(vm[1]);
      return send(res, r.status, method === 'HEAD' ? Buffer.alloc(0) : r.body, r.headers, true);
    }

    const { route, params, pathMatched } = router.match(method, path);
    if (!route) {
      if (pathMatched) throw new HttpError(405, 'Metod ruxsat etilmagan');
      throw notFound('Endpoint topilmadi');
    }

    // --- autentifikatsiya va rollar ---
    let user = null;
    if (route.auth !== false) {
      const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
      if (!m) throw unauthorized('Token kerak', { code: 'missing_token' });
      const payload = tokens.verifyAccess(m[1]);
      user = await repo.userById(payload.sub);
      if (!user || !user.active) throw unauthorized('Foydalanuvchi faol emas', { code: 'invalid_token' });
      state.userId = user.id;
      if (route.roles && !route.roles.includes(user.role)) throw forbidden('Bu amal uchun ruxsat yoʻq');
    }

    // --- so'rov tanasi va query ---
    let body;
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      const ct = req.headers['content-type'] || '';
      if (route.allowMultipart && /^multipart\/form-data\b/i.test(ct)) {
        await runMemoryUpload(req, res);
        if (!req.file || !req.file.buffer?.length) {
          throw unprocessable('Fayl tanlanmadi yoki boʻsh');
        }
        body = {
          filename: req.file.originalname || 'fayl',
          mime_type: req.file.mimetype || 'application/octet-stream',
          buffer: req.file.buffer,
          note: req.body?.note != null ? String(req.body.note) : null,
        };
      } else {
        const raw = await readBody(req, route.maxBodyBytes ?? config.bodyLimit);
        if (route.body) {
          let parsed = {};
          if (raw.length) {
            if (!/^application\/json\b/i.test(ct)) {
              throw new HttpError(415, 'Content-Type application/json boʻlishi kerak', { code: 'unsupported_media_type' });
            }
            try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw badRequest('JSON notoʻgʻri'); }
          }
          body = validateOrThrow(route.body, parsed);
        }
      }
    }
    const query = route.query ? validateOrThrow(route.query, Object.fromEntries(url.searchParams), { coerce: true }) : {};

    if (route.rateLimit === 'login') {
      limitOrThrow(loginIpLimiter, `ip:${state.ip}`, res);
      limitOrThrow(loginIdLimiter, `${state.ip}:${body.id}`, res);
    }

    const ctx = { user, ip: state.ip, reqId: state.reqId };
    const result = await route.handler({ user, params, query, body, ctx, headers: req.headers });
    if (result instanceof Reply) return send(res, result.status, result.body, result.headers, result.raw);
    return send(res, route.status ?? 200, result);
  }

  async function handleStatic(req, res, url) {
    const entry = STATIC[url.pathname];
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !entry) throw notFound('Topilmadi');
    const [file, type, kind] = entry;
    let data;
    try { data = await readFile(new URL(file, PUBLIC_DIR)); } catch { throw notFound('Topilmadi'); }
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': data.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Content-Security-Policy': CSP[kind],
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    const state = { reqId: randomUUID().slice(0, 8), ip: clientIp(req), userId: null };
    let path = req.url;
    try {
      res.setHeader('X-Request-Id', state.reqId);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', CSP.api);

      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { throw badRequest('URL notoʻgʻri'); }
      path = url.pathname;
      applyCors(req, res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, { Allow: 'GET,POST,PATCH,DELETE,OPTIONS' });
        res.end();
      } else if (req.method === 'GET' && path === '/health') {
        let dbOk = false;
        try { dbOk = await repo.ping(); } catch { dbOk = false; }
        send(res, dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'error', db: dbOk ? 'ok' : 'error', version });
      } else if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
        await handleApi(req, res, url, state);
      } else {
        await handleStatic(req, res, url);
      }
    } catch (e) {
      const known = e instanceof HttpError;
      if (!known) logger.error('unhandled_error', { reqId: state.reqId, error: e?.message, stack: e?.stack });
      if (res.headersSent) { res.destroy(); return; }
      const status = known ? e.status : 500;
      const extra = {};
      if (status === 401) extra['WWW-Authenticate'] = 'Bearer';
      if (status === 413) extra.Connection = 'close';
      send(res, status, {
        error: known ? e.message : 'Server xatosi',
        code: known ? e.code : 'internal_error',
        ...(known && e.details ? { details: e.details } : {}),
        request_id: state.reqId,
      }, extra);
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', { reqId: state.reqId, method: req.method, path, status: res.statusCode, ms: Math.round(ms * 10) / 10, ip: state.ip, user: state.userId });
    }
  }

  const server = createServer((req, res) => { handle(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  return {
    server, handle, repo, svc, tokens, telegram, openapi, routes,
    limiters: { generalLimiter, loginIdLimiter, loginIpLimiter },
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeIdleConnections?.(); }),
  };
}
