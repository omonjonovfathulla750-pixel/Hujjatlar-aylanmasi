import { randomUUID, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { burnPasswordCheck, hashPassword, verifyPassword } from './auth.js';
import { tx } from './db.js';
import { todayIn } from './dates.js';
import { Reply, conflict, forbidden, notFound, unauthorized, unprocessable } from './errors.js';
import { buildDocx, buildXlsx } from './export.js';
import { previewDocx, previewXlsx } from './preview.js';
import { createRepo } from './repo.js';
import { assigneeStatus, docStatus, summarize, taskStatus } from './status.js';

export const isManager = (u) => u.role === 'admin' || u.role === 'operator';
export const canSeeAll = (u) => u.role !== 'user';

export function paginate(items, page = 1, perPage = 20) {
  const total = items.length;
  return { data: items.slice((page - 1) * perPage, page * perPage), meta: { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) } };
}

const isUniqueError = (e) => e && (e.errcode === 2067 || e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/i.test(e.message || ''));

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.rtf', '.odt', '.ods', '.png', '.jpg', '.jpeg', '.webp', '.zip', '.rar', '.7z',
]);
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
};
const SAFE_INLINE_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv']);
const INTEGRATION_KEYS = ['sms_provider', 'doc_system', 'email_provider', 'telegram_bot'];
const SECRET_FIELDS = ['password', 'token', 'bot_token'];

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIp(rawIp) {
  const ip = String(rawIp || '').toLowerCase().split('%')[0];
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (!net.isIPv6(ip)) return true;
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') return true;
  if (ip.startsWith('::ffff:')) {
    const rest = ip.slice(7);
    if (net.isIPv4(rest)) return isPrivateIpv4(rest);
    const hex = rest.split(':');
    if (hex.length === 2 && hex.every((h) => /^[0-9a-f]{1,4}$/.test(h))) {
      const hi = parseInt(hex[0], 16);
      const lo = parseInt(hex[1], 16);
      return isPrivateIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    return true;
  }
  const head = ip.split(':')[0] || '';
  if (/^(fc|fd)[0-9a-f]{2}$/.test(head) || /^fe[89ab][0-9a-f]$/.test(head)) return true;
  return false;
}

async function validateExternalUrl(rawUrl, resolveDns = false) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw unprocessable('API manzili noto\u02bbg\u02bbri formatda'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw unprocessable('Faqat HTTP yoki HTTPS manzillariga ruxsat berilgan');
  }
  if (u.username || u.password) {
    throw unprocessable('API manzilida login yoki parol ko\u02bbrsatish mumkin emas');
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw unprocessable('Lokal yoki ichki tarmoq manzillariga ruxsat berilmaydi');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw unprocessable('Ichki IP manzillariga ruxsat berilmaydi');
    return u.toString();
  }
  if (resolveDns) {
    let addrs;
    try { addrs = await dns.lookup(host, { all: true }); } catch { throw unprocessable('API xostini aniqlab bo\u02bblmadi'); }
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      throw unprocessable('Ichki tarmoqqa yo\u02bbnaltirilgan API manzili taqiqlangan');
    }
  }
  return u.toString();
}

function maskIntegrationSecrets(val) {
  if (!val || typeof val !== 'object') return val;
  const out = { ...val };
  for (const f of SECRET_FIELDS) {
    if (f in out) {
      out[`has_${f}`] = Boolean(out[f]);
      out[f] = '';
    }
  }
  return out;
}

const STATUS_LABELS = { ok: 'Vaqtida bajarildi', late: 'Muddatdan oshdi', prog: 'Jarayonda', new: 'Biriktirilmagan' };
const PRIORITY_LABELS = { urgent: 'Shoshilinch', high: 'Yuqori', normal: 'Oddiy', low: 'Past' };
function formatTzDateTime(isoStr, tz) {
  if (!isoStr) return 'Koʻrilmagan';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return String(isoStr);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function sanitizeFilename(name) {
  const base = String(name || 'fayl').replace(/[\x00-\x1F\x7F/\\]+/g, '_').replace(/^\.+/, '').trim();
  return (base || 'fayl').slice(0, 200);
}

function fileExt(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function contentDisposition(filename, disposition = 'attachment') {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createService({ db, repo, tokens, config, now = () => new Date(), telegram = null }) {
  const today = () => todayIn(config.tz, now());
  const nowIso = () => now().toISOString();
  const viewTickets = new Map();

  const requireManager = (u) => { if (!isManager(u)) throw forbidden('Bu amal uchun ruxsat yo\u02bbq'); };
  const requireAdmin = (u) => { if (u.role !== 'admin') throw forbidden('Faqat administrator uchun'); };

  const audit = (r, ctx, action, entity, entity_id, details) =>
    r.insertAudit({ at: nowIso(), user_id: ctx.user?.id ?? null, action, entity, entity_id, details, ip: ctx.ip });

  const addEvent = (r, doc_id, user_id, event_type, details) =>
    r.insertEvent({ doc_id, user_id, event_type, details, created_at: nowIso() });

  const notify = (r, user_id, type, title, body, doc_id = null) =>
    r.insertNotification({ user_id, doc_id, type, title, body, created_at: nowIso() });

  const publicUser = (u, viewer) => {
    const out = {
      id: u.id, name: u.name, org_id: u.org_id,
      department: u.department ?? null, pos: u.pos, role: u.role, active: !!u.active,
      telegram_linked: Boolean(u.telegram_chat_id),
      created_at: u.created_at ?? null,
    };
    if (viewer.role === 'admin') out.code = u.code;
    if (viewer.id === u.id || viewer.role === 'admin') {
      out.auth_reset_required = !!u.must_change_password;
      out.telegram_chat_id = u.telegram_chat_id ?? null;
      out.telegram_username = u.telegram_username ?? null;
    }
    if (viewer.id === u.id || viewer.role === 'admin' || viewer.role === 'operator' || viewer.role === 'viewer') {
      out.onboarding_required = u.code === 'U001';
    }
    return out;
  };

  function serializeDoc(d, t = today()) {
    return {
      ...d,
      status: docStatus(d),
      tasks: d.tasks.map((task) => ({
        ...task,
        status: taskStatus(task, t),
        assignees: task.assignees.map((a) => ({ ...a, status: assigneeStatus(a, task, t) })),
      })),
    };
  }

  const visibleTo = (user, d) =>
    canSeeAll(user) || d.created_by === user.id
    || d.signatures.some((s) => s.user_id === user.id)
    || d.tasks.some((t) => t.assignees.some((a) => a.user_id === user.id));

  async function loadVisibleDoc(user, id) {
    const d = await repo.docById(id);
    if (!d || !visibleTo(user, d)) throw notFound('Hujjat topilmadi');
    return d;
  }

  async function scopedTasks(user, { user_id, org_id, doc_id, q } = {}) {
    const t = today();
    const targetUid = !canSeeAll(user) ? user.id : (user_id || null);
    const docs = await repo.findDocs({ user: canSeeAll(user) ? null : user, org_id, q });
    let items = docs.flatMap((d) => d.tasks.map((task) => {
      let assignees = task.assignees.map((a) => ({ ...a, status: assigneeStatus(a, task, t) }));
      let st = taskStatus(task, t);
      if (targetUid) {
        const own = assignees.find((a) => a.user_id === targetUid);
        if (!own) return null;
        assignees = [own];
        st = own.status;
      }
      return {
        id: task.id, doc_id: d.id, doc_number: d.number, doc_type: d.type, doc_title: d.title,
        org_id: d.org_id, department: d.department ?? null, priority: d.priority || 'normal',
        title: task.title, issued_by: task.issued_by, deadline: task.deadline, date: d.created_at,
        status: st,
        assignees,
      };
    })).filter(Boolean);
    if (doc_id) items = items.filter((x) => x.doc_id === doc_id);
    return items;
  }

  function inPeriod(item, year, month) {
    if (year && !item.date.startsWith(`${year}-`)) return false;
    if (month && Number(item.date.slice(5, 7)) !== month) return false;
    return true;
  }

  function checkPeriod({ year, month }) {
    if (month && !year) throw unprocessable('month uchun year ham kerak');
  }

  async function activeUserOrThrow(id, { executor = false, message, r = repo }) {
    const u = await r.userById(id);
    if (!u || !u.active || (executor && u.role !== 'user')) throw unprocessable(message);
    return u;
  }

  async function mapUnique(fn, message) {
    try { return await fn(); } catch (e) {
      if (isUniqueError(e)) throw conflict(message);
      throw e;
    }
  }

  async function resolveAttachmentBuffer(att) {
    if (att?.data != null) {
      const buf = Buffer.from(att.data);
      if (buf.length > 0) return buf;
    }
    if (att?.tg_file_id && telegram?.hasBot()) {
      return telegram.downloadFileBytes(att.tg_file_id);
    }
    throw notFound('Fayl ma\u02bblumoti topilmadi');
  }

  async function notifyAssignmentTelegram({ assigneeUser, docNumber, docTitle, deadline, docFiles = [] }) {
    if (!telegram?.hasBot() || !assigneeUser?.telegram_chat_id) return;
    const msgText = `Hurmatli ${assigneeUser.name}, sizga № ${docNumber} / ${docTitle} nazorat varaqasi biriktirildi. Ijro muddati: ${deadline}.`;
    try {
      if (docFiles.length > 0) {
        const first = docFiles[0];
        await telegram.sendDocument({
          chatId: assigneeUser.telegram_chat_id,
          fileId: first.tg_file_id || null,
          buffer: !first.tg_file_id && first.data ? Buffer.from(first.data) : null,
          filename: first.orig_name,
          mimeType: first.mime_type,
          caption: msgText,
        });
        for (const extraFile of docFiles.slice(1)) {
          await telegram.sendDocument({
            chatId: assigneeUser.telegram_chat_id,
            fileId: extraFile.tg_file_id || null,
            buffer: !extraFile.tg_file_id && extraFile.data ? Buffer.from(extraFile.data) : null,
            filename: extraFile.orig_name,
            mimeType: extraFile.mime_type,
            caption: `📎 № ${docNumber} ilova fayli: ${extraFile.orig_name}`,
          });
        }
      } else {
        await telegram.sendMessage({ chatId: assigneeUser.telegram_chat_id, text: msgText });
      }
    } catch {
      // Telegram xatosi asosiy topshiriq biriktirishni to'xtatmaydi
    }
  }

  async function notifyCompletionTelegram({ recipientIds, doc, assigneeUser, filename, tgMeta, buf, mime, note, doneAt }) {
    if (!telegram?.hasBot() || !recipientIds?.length) return;
    const targets = new Set();
    for (const rid of recipientIds) {
      if (!rid || rid === assigneeUser.id) continue;
      const u = await repo.userById(rid);
      if (u?.active && u.telegram_chat_id && !targets.has(u.telegram_chat_id)) {
        targets.add(u.telegram_chat_id);
        const caption = [
          `✅ Topshiriq bajarildi!`,
          `📄 Hujjat: № ${doc.number} — ${doc.title}`,
          `👤 Xodim: ${assigneeUser.name}`,
          `📝 Iqtibos: ${note}`,
          `🕒 Vaqt: ${formatTzDateTime(doneAt, config.tz)}`,
        ].join('\n');
        try {
          await telegram.sendDocument({
            chatId: u.telegram_chat_id,
            fileId: tgMeta?.file_id || null,
            buffer: tgMeta?.file_id ? null : buf,
            filename,
            mimeType: mime,
            caption,
          });
        } catch {
          // Rahbar botiga yuborishda xato bo'lsa asosiy so'rovni yiqitmaymiz
        }
      }
    }
  }

  return {
    today,

    // ---- autentifikatsiya ----
    async login(ctx, { id, password }) {
      const user = await repo.userByCodeIgnoreCase(String(id).trim());
      let ok = false;
      if (user && user.active && user.password_hash) ok = verifyPassword(password, user.password_hash);
      else burnPasswordCheck(password);
      if (!ok) {
        await audit(repo, ctx, 'login_failed', 'user', user?.id ?? null, { code: String(id).slice(0, 64) });
        throw unauthorized('ID yoki parol noto\u02bbg\u02bbri', { code: 'invalid_credentials' });
      }
      await audit(repo, { ...ctx, user }, 'login', 'user', user.id, null);
      return { ...(await tokens.issue(user)), user: publicUser(user, user) };
    },

    async refresh(ctx, refreshToken) {
      const { user, tokens: t } = await tokens.rotate(refreshToken, repo.userById);
      await audit(repo, { ...ctx, user }, 'token_refresh', 'user', user.id, null);
      return { ...t, user: publicUser(user, user) };
    },

    async logout(ctx, refreshToken) {
      const revoked = refreshToken ? await tokens.revoke(refreshToken) : false;
      await audit(repo, ctx, 'logout', 'user', ctx.user?.id ?? null, { revoked });
      return { ok: true };
    },

    async changeOwnPassword(ctx, { current_password, new_password }) {
      const u = await repo.userById(ctx.user.id);
      if (!u || !u.active || !u.password_hash) throw unauthorized('Foydalanuvchi faol emas');
      if (!verifyPassword(current_password, u.password_hash)) {
        throw unprocessable('Joriy parol noto\u02bbg\u02bbri');
      }
      if (!new_password || new_password.length < 8) {
        throw unprocessable('Yangi parol kamida 8 belgi bo\u02bblishi kerak');
      }
      await repo.setPassword(u.id, hashPassword(new_password), 0);
      await tokens.revokeAllForUser(u.id);
      const updated = await repo.userById(u.id);
      await audit(repo, ctx, 'password_change', 'user', u.id, null);
      return { ok: true, ...(await tokens.issue(updated)), user: publicUser(updated, updated) };
    },

    async registerEmployee(ctx, b) {
      if (ctx.user.code !== 'U001') {
        throw forbidden('Faqat boshlangʻich U001 shablon akkaunti orqali roʻyxatdan oʻtish mumkin');
      }
      const login = String(b.login || '').trim();
      if (!/^[a-zA-Z0-9._-]{2,64}$/.test(login)) {
        throw unprocessable('Login faqat lotin harflari, raqamlar va . _ - belgilaridan iborat boʻlishi kerak (2-64 belgi)');
      }
      if (b.password_confirm !== undefined && b.password !== b.password_confirm) {
        throw unprocessable('Parol va tasdiqlash paroli mos kelmadi');
      }
      if (await repo.userByCodeIgnoreCase(login)) {
        throw conflict('Bu login allaqachon band qilingan, boshqa login tanlang');
      }
      const orgId = b.org_id || ctx.user.org_id || 1;
      if (!(await repo.orgById(orgId))) throw unprocessable('Tashkilot topilmadi');

      const newId = await mapUnique(() => repo.insertUser({
        name: b.full_name,
        org_id: orgId,
        department: b.department ?? null,
        pos: b.position,
        role: 'user',
        code: login,
        password_hash: hashPassword(b.password),
        must_change_password: 0,
        created_at: nowIso(),
      }), 'Bu login allaqachon band qilingan, boshqa login tanlang');

      const created = await repo.userById(newId);
      await audit(repo, { ...ctx, user: created }, 'register_employee', 'user', created.id, { login });
      return { ok: true, ...(await tokens.issue(created)), user: publicUser(created, created) };
    },

    me: (user) => publicUser(user, user),

    async bootstrap(user) {
      const [orgs, rawUsers, docs, sms, unread] = await Promise.all([
        repo.listOrgs(),
        repo.listUsers(),
        repo.findDocs({ user: canSeeAll(user) ? null : user }),
        isManager(user) ? repo.listSms() : Promise.resolve([]),
        repo.countUnread(user.id),
      ]);
      return {
        me: {
          id: user.id,
          name: user.name,
          role: user.role,
          department: user.department ?? null,
          auth_reset_required: !!user.must_change_password,
          onboarding_required: user.code === 'U001',
          telegram_linked: Boolean(user.telegram_chat_id),
        },
        today: today(),
        orgs,
        users: rawUsers.map((u) => publicUser(u, user)),
        docs,
        sms,
        unread,
      };
    },

    // ---- telegram integratsiyasi ----
    async getTelegramLink(user) {
      const bot = telegram?.hasBot() ? await telegram.getMe() : null;
      const username = bot?.username || null;
      const canLink = Boolean(telegram && username && user.code !== 'U001');
      return {
        enabled: Boolean(telegram?.hasBot()),
        linked: Boolean(user.telegram_chat_id),
        telegram_chat_id: user.telegram_chat_id ?? null,
        telegram_username: user.telegram_username ?? null,
        bot_username: username,
        url: canLink ? `https://t.me/${username}?start=link_${telegram.createLinkToken(user.id)}` : null,
      };
    },

    async linkTelegram(ctx, { init_data, chat_id }) {
      if (ctx.user.code === 'U001') {
        throw unprocessable('Avval shaxsiy profil yarating, soʻngra Telegramga ulang');
      }
      if (init_data) {
        const tgUser = telegram?.verifyWebAppInitData(init_data);
        if (!tgUser) throw unprocessable('Telegram WebApp maʼlumotlari tasdiqlanmadi');
        await repo.setTelegramChat(ctx.user.id, String(tgUser.id), tgUser.username || null);
      } else if (chat_id && isManager(ctx.user)) {
        await repo.setTelegramChat(ctx.user.id, String(chat_id), null);
      } else {
        throw unprocessable('Telegram bogʻlash maʼlumotlari yetarli emas');
      }
      const updated = await repo.userById(ctx.user.id);
      await audit(repo, ctx, 'telegram_link', 'user', ctx.user.id, { chat_id: updated.telegram_chat_id });
      return { ok: true, user: publicUser(updated, updated) };
    },

    async handleTelegramWebhook(update, headers = {}) {
      if (config.tgWebhookSecret) {
        const got = String(headers['x-telegram-bot-api-secret-token'] || '');
        const a = Buffer.from(got);
        const b = Buffer.from(config.tgWebhookSecret);
        if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) {
          throw forbidden('Telegram webhook secret notoʻgʻri');
        }
      }
      if (!telegram) return { ok: true, skipped: true };
      return telegram.handleUpdate(update, { repo, verifyPassword, nowIso });
    },

    // ---- arxiv ----
    async listArchive(user) {
      const rows = await repo.listArchive({ user: canSeeAll(user) ? null : user });
      return { data: rows };
    },

    // ---- hujjatlar ----
    async listDocuments(user, f) {
      if (f.date_from && f.date_to && f.date_from > f.date_to) throw unprocessable('date_from date_to dan keyin bo\u02bblishi mumkin emas');
      const t = today();
      let docs = (await repo.findDocs({ user: canSeeAll(user) ? null : user, q: f.q, org_id: f.org_id, date_from: f.date_from, date_to: f.date_to }))
        .map((d) => serializeDoc(d, t));
      if (f.status) docs = docs.filter((d) => d.tasks.some((x) => x.status === f.status));
      if (f.doc_status) docs = docs.filter((d) => d.status === f.doc_status);
      return paginate(docs, f.page, f.per_page);
    },

    async getDocument(user, id) {
      let d = await loadVisibleDoc(user, id);
      const nowT = nowIso();
      let updated = false;
      for (const task of d.tasks) {
        for (const a of task.assignees) {
          if (a.user_id === user.id && !a.viewed_at) {
            if (await repo.setViewed(a.id, user.id, nowT)) updated = true;
          }
        }
      }
      if (!(await repo.hasEvent(id, user.id, 'viewed'))) {
        await addEvent(repo, id, user.id, 'viewed', { role: user.role });
      }
      if (updated) d = await repo.docById(id);
      return serializeDoc(d);
    },

    async getDocumentTimeline(user, id) {
      await loadVisibleDoc(user, id);
      const [events, doc, allUsers, allOrgs] = await Promise.all([
        repo.listEvents(id),
        repo.docById(id),
        repo.listUsers(),
        repo.listOrgs(),
      ]);
      const userMap = new Map(allUsers.map((u) => [u.id, u]));
      const orgMap = new Map(allOrgs.map((o) => [o.id, o]));
      const viewedMap = {};
      for (const ev of events.filter((e) => e.event_type === 'viewed')) {
        const uid = ev.user_id;
        if (!viewedMap[uid] || ev.created_at < viewedMap[uid]) viewedMap[uid] = ev.created_at;
      }
      const timeline = [];
      const evCreated = events.find((e) => e.event_type === 'created');
      timeline.push({ time: evCreated?.created_at || doc.created_at, type: 'created', label: 'Hujjat yaratildi', user_id: doc.created_by, user_name: userMap.get(doc.created_by)?.name });
      for (const t of doc.tasks) {
        for (const a of t.assignees) {
          const aUser = userMap.get(a.user_id);
          const issuer = userMap.get(a.assigned_by);
          const evAssigned = events.find((e) => e.event_type === 'assigned' && e.details?.to === a.user_id && (!e.details?.task_id || e.details.task_id === t.id));
          const assignedTime = evAssigned?.created_at || a.assigned_at;
          timeline.push({ time: assignedTime, type: 'assigned', label: `${issuer?.name || '—'} → ${aUser?.name || '—'} ga biriktirdi`, user_id: a.assigned_by, user_name: issuer?.name, target_user_id: a.user_id, target_user_name: aUser?.name, task_title: t.title, deadline: t.deadline });
          const vt = a.viewed_at || viewedMap[a.user_id];
          if (vt) {
            let waitMin = null;
            if (assignedTime.includes('T') && vt.includes('T')) {
              const diff = Math.round((new Date(vt).getTime() - new Date(assignedTime).getTime()) / 60000);
              waitMin = diff > 0 ? diff : 0;
            }
            timeline.push({ time: vt, type: 'viewed', label: `${aUser?.name || '—'} hujjatni ko\u02bbrib chiqdi`, user_id: a.user_id, user_name: aUser?.name, wait_minutes: waitMin });
          }
          if (a.delegated_to) {
            const toUser = userMap.get(a.delegated_to);
            timeline.push({ time: a.delegated_at || assignedTime, type: 'delegated', label: `${aUser?.name || '—'} → ${toUser?.name || '—'} ga uzatdi`, user_id: a.user_id, user_name: aUser?.name, target_user_id: a.delegated_to, target_user_name: toUser?.name, note: a.delegation_note });
          }
          if (a.done_date) {
            const onTime = a.done_date <= t.deadline;
            const evDone = events.findLast((e) => (e.event_type === 'completed' || e.event_type === 'completed_late') && e.user_id === a.user_id);
            timeline.push({ time: evDone?.created_at || a.done_at || a.done_date, type: onTime ? 'completed' : 'completed_late', label: `${aUser?.name || '—'} topshiriqni ${onTime ? 'o\u02bbz vaqtida' : 'kechikib'} yakunladi`, user_id: a.user_id, user_name: aUser?.name, deadline: t.deadline, on_time: onTime, note: a.completion_note || null });
          }
        }
      }
      for (const s of doc.signatures) {
        if (s.signed_at) {
          const sUser = userMap.get(s.user_id);
          const evSign = events.find((e) => e.event_type === 'signed' && e.user_id === s.user_id);
          timeline.push({ time: evSign?.created_at || s.signed_at, type: 'signed', label: `${sUser?.name || '—'} hujjatni imzoladi`, user_id: s.user_id, user_name: sUser?.name });
        }
      }
      for (const tr of doc.transfers) {
        const fromOrg = orgMap.get(tr.from_org);
        const toOrg = orgMap.get(tr.to_org);
        const evTr = events.find((e) => e.event_type === 'transferred' && e.details?.to_org === tr.to_org);
        timeline.push({ time: evTr?.created_at || tr.sent_at, type: 'transferred', label: `${fromOrg?.name || '—'} → ${toOrg?.name || '—'} ga yuborildi`, from_org: tr.from_org, to_org: tr.to_org });
        if (tr.received_at) timeline.push({ time: tr.received_at, type: 'received', label: `${toOrg?.name || '—'} hujjatni qabul qildi` });
      }
      for (const ev of events.filter((e) => e.event_type === 'file_uploaded' || e.event_type === 'response_file' || e.event_type === 'unassigned' || e.event_type === 'task_deleted')) {
        let label = `${ev.user_name || '—'} hujjatga fayl biriktirdi`;
        if (ev.event_type === 'response_file') label = `${ev.user_name || '—'} javob faylini yukladi`;
        else if (ev.event_type === 'unassigned') label = `${ev.user_name || '—'} ${ev.details?.user_name || 'xodim'} ning vazifasini bekor qildi`;
        else if (ev.event_type === 'task_deleted') label = `${ev.user_name || '—'} topshiriqni oʻchirdi`;
        timeline.push({
          time: ev.created_at,
          type: ev.event_type,
          label,
          user_id: ev.user_id,
          user_name: ev.user_name,
          note: [ev.details?.filename, ev.details?.note, ev.details?.title].filter(Boolean).join(' — ') || null,
        });
      }
      timeline.sort((a, b) => a.time.localeCompare(b.time));
      return { doc_id: id, doc_number: doc.number, doc_title: doc.title, timeline };
    },

    async createDocument(ctx, b) {
      requireManager(ctx.user);
      const t = today();
      if (b.deadline < t) throw unprocessable('Muddat o\u02bbtib ketgan sana bo\u02bblishi mumkin emas');
      if (!(await repo.orgById(b.org_id))) throw unprocessable('Tashkilot topilmadi');
      if (await repo.docByNumber(b.number)) throw conflict('Bunday raqamli hujjat allaqachon mavjud');
      const signers = [...new Set(b.signers || [])];
      for (const s of signers) await activeUserOrThrow(s, { message: `Imzolovchi topilmadi: ${s}` });
      const assignee = b.assignee != null ? await activeUserOrThrow(b.assignee, { executor: true, message: 'Bajaruvchi noto\u02bbg\u02bbri' }) : null;

      const id = await mapUnique(() => tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        const docId = await trepo.insertDoc({
          number: b.number, type: b.type, title: b.title, org_id: b.org_id,
          department: b.department || null, priority: b.priority || 'normal',
          created_by: ctx.user.id, created_at: t,
        });
        const taskId = await trepo.insertTask({ doc_id: docId, title: b.title, issued_by: ctx.user.id, deadline: b.deadline });
        for (let i = 0; i < signers.length; i += 1) {
          await trepo.insertSignature({ doc_id: docId, user_id: signers[i], ord: i + 1 });
        }
        await addEvent(trepo, docId, ctx.user.id, 'created', { number: b.number, type: b.type });
        if (assignee) {
          await trepo.insertAssignee({ task_id: taskId, user_id: assignee.id, assigned_by: ctx.user.id, assigned_at: t });
          await trepo.enqueueSmsPhone({ to: assignee.name, phone: null, text: `\u2116 ${b.number} nazorat varaqasi sizga biriktirildi`, at: t });
          await addEvent(trepo, docId, ctx.user.id, 'assigned', { to: assignee.id, to_name: assignee.name });
          await notify(trepo, assignee.id, 'new_task', `Yangi topshiriq: \u2116 ${b.number}`, b.title, docId);
        }
        await audit(trepo, ctx, 'document_create', 'document', docId, { number: b.number });
        return docId;
      }), 'Bunday raqamli hujjat allaqachon mavjud');

      if (assignee) {
        await notifyAssignmentTelegram({
          assigneeUser: assignee,
          docNumber: b.number,
          docTitle: b.title,
          deadline: b.deadline,
          docFiles: [],
        });
      }
      return serializeDoc(await repo.docById(id), t);
    },

    async updateDocument(ctx, id, b) {
      requireManager(ctx.user);
      if (!(await repo.docById(id))) throw notFound('Hujjat topilmadi');
      const fields = {};
      for (const k of ['number', 'type', 'title', 'org_id', 'department', 'priority']) if (b[k] !== undefined) fields[k] = b[k];
      if (!Object.keys(fields).length) throw unprocessable('O\u02bbzgartirish uchun kamida bitta maydon kerak');
      if (fields.org_id !== undefined && !(await repo.orgById(fields.org_id))) throw unprocessable('Tashkilot topilmadi');
      if (fields.number) { const other = await repo.docByNumber(fields.number); if (other && other.id !== id) throw conflict('Bunday raqamli hujjat allaqachon mavjud'); }
      await mapUnique(() => repo.updateDoc(id, fields), 'Bunday raqamli hujjat allaqachon mavjud');
      await audit(repo, ctx, 'document_update', 'document', id, fields);
      return serializeDoc(await repo.docById(id));
    },

    async deleteDocument(ctx, id) {
      requireAdmin(ctx.user);
      const d = await repo.docById(id);
      if (!d) throw notFound('Hujjat topilmadi');
      await repo.deleteDoc(id);
      await audit(repo, ctx, 'document_delete', 'document', id, { number: d.number });
    },

    async sign(ctx, docId) {
      await loadVisibleDoc(ctx.user, docId);
      const s = await repo.pendingSignature(docId, ctx.user.id);
      if (!s) throw forbidden('Imzolash mumkin emas');
      await repo.sign(s.id, today());
      await addEvent(repo, docId, ctx.user.id, 'signed', null);
      await audit(repo, ctx, 'document_sign', 'document', docId, null);
      return serializeDoc(await repo.docById(docId));
    },

    async send(ctx, docId, orgId) {
      requireManager(ctx.user);
      const d = await repo.docById(docId);
      if (!d) throw notFound('Hujjat topilmadi');
      if (!(await repo.orgById(orgId)) || orgId === d.org_id) throw unprocessable('Tashkilot noto\u02bbg\u02bbri');
      if (d.transfers.some((x) => x.to_org === orgId)) throw conflict('Hujjat bu tashkilotga allaqachon yuborilgan');
      await repo.insertTransfer({ doc_id: docId, from_org: d.org_id, to_org: orgId, sent_at: today() });
      await addEvent(repo, docId, ctx.user.id, 'transferred', { from_org: d.org_id, to_org: orgId });
      await audit(repo, ctx, 'document_send', 'document', docId, { to_org: orgId });
      return serializeDoc(await repo.docById(docId));
    },

    // ---- fayllar (attachments + Telegram maxfiy kanal arxivi) ----
    async uploadAttachment(ctx, { docId = null, assigneeId = null, kind = 'document', filename, data_base64, buffer = null, note = null }) {
      let targetDocId = docId;
      let targetAssignee = null;
      let targetDoc = null;

      const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null;

      if (kind === 'response') {
        targetAssignee = await repo.assigneeById(assigneeId);
        if (!targetAssignee) throw notFound('Topshiriq bajaruvchisi topilmadi');
        if (targetAssignee.user_id !== ctx.user.id) {
          throw forbidden('Javob faylini faqat biriktirilgan xodimning o\u02bbzi yuklashi mumkin');
        }
        if (!cleanNote) {
          throw unprocessable('Topshiriqqa javob yuborish uchun majburiy iqtibos / ijro tavsifi kiritilishi shart');
        }
        targetDocId = targetAssignee.doc_id;
        targetDoc = await repo.docById(targetDocId);
      } else {
        requireManager(ctx.user);
        targetDoc = await repo.docById(targetDocId);
        if (!targetDoc) throw notFound('Hujjat topilmadi');
      }

      const safeName = sanitizeFilename(filename);
      const ext = fileExt(safeName);
      if (!ALLOWED_EXTS.has(ext)) {
        throw unprocessable(`Ruxsat etilmagan fayl turi (${ext || 'noma\u02bblum'}). PDF, Word, Excel, PowerPoint, matn, rasm yoki arxiv yuklang`);
      }

      let buf;
      if (Buffer.isBuffer(buffer)) {
        buf = buffer;
      } else {
        const cleanB64 = String(data_base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
        if (!cleanB64) throw unprocessable('Fayl ma\u02bblumoti bo\u02bbsh');
        buf = Buffer.from(cleanB64, 'base64');
      }
      if (!buf.length) throw unprocessable('Fayl bo\u02bbsh bo\u02bblishi mumkin emas');
      if (buf.length > MAX_FILE_BYTES) throw unprocessable('Fayl hajmi 10 MB dan oshmasligi kerak');

      const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
      const nowT = nowIso();
      const doneDate = today();

      let tgMeta = null;
      if (telegram?.hasArchive()) {
        const caption = kind === 'response'
          ? `📥 Javob fayli | № ${targetDoc?.number || targetDocId}\n👤 Xodim: ${ctx.user.name}\n📝 Tavsif: ${cleanNote}`
          : `📎 Hujjat fayli | № ${targetDoc?.number || targetDocId}${targetDoc?.title ? ' — ' + targetDoc.title : ''}${cleanNote ? '\n📝 Tavsif: ' + cleanNote : ''}`;
        tgMeta = await telegram.uploadToArchive({ buffer: buf, filename: safeName, mimeType: mime, caption });
      }

      const attId = await tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        const id = await trepo.insertAttachment({
          doc_id: targetDocId,
          assignee_id: targetAssignee ? targetAssignee.id : null,
          uploaded_by: ctx.user.id,
          kind,
          orig_name: safeName,
          mime_type: tgMeta?.mime_type || mime,
          size_bytes: tgMeta?.file_size || buf.length,
          note: cleanNote,
          data: tgMeta ? null : buf,
          tg_file_id: tgMeta?.file_id || null,
          tg_message_id: tgMeta?.message_id || null,
          tg_chat_id: tgMeta?.chat_id || null,
          created_at: nowT,
        });
        const doc = await trepo.docById(targetDocId);
        if (targetAssignee) {
          await trepo.setViewed(targetAssignee.id, targetAssignee.user_id, nowT);
          await addEvent(trepo, targetDocId, ctx.user.id, 'response_file', { filename: safeName, attachment_id: id, assignee_id: targetAssignee.id, note: cleanNote });
          await trepo.setDone(targetAssignee.id, targetAssignee.done_date || doneDate, cleanNote, nowT);
          if (!targetAssignee.done_date) {
            const task = await trepo.taskById(targetAssignee.task_id);
            if (task) {
              const onTime = doneDate <= task.deadline;
              await addEvent(trepo, targetDocId, ctx.user.id, onTime ? 'completed' : 'completed_late', { done_date: doneDate, deadline: task.deadline, note: cleanNote });
            }
          }
          if (doc && doc.created_by !== ctx.user.id) {
            await notify(trepo, doc.created_by, 'response_file', `Javob fayli (bajarildi): \u2116 ${doc.number}`, `${ctx.user.name} — ${safeName} — ${cleanNote}`, targetDocId);
          }
        } else {
          await addEvent(trepo, targetDocId, ctx.user.id, 'file_uploaded', { filename: safeName, attachment_id: id, note: cleanNote });
          if (doc) {
            const uids = [...new Set(doc.tasks.flatMap((t) => t.assignees.map((a) => a.user_id)))].filter((uid) => uid !== ctx.user.id);
            for (const uid of uids) {
              await notify(trepo, uid, 'file_uploaded', `Hujjatga fayl biriktirildi: \u2116 ${doc.number}`, `${safeName}${cleanNote ? ' — ' + cleanNote : ' — ' + doc.title}`, targetDocId);
            }
          }
        }
        await audit(trepo, ctx, 'file_upload', 'attachment', id, { doc_id: targetDocId, kind, filename: safeName, size: buf.length, archived_tg: Boolean(tgMeta) });
        return id;
      });

      if (kind === 'response' && targetDoc) {
        await notifyCompletionTelegram({
          recipientIds: [targetAssignee.issued_by, targetDoc.created_by],
          doc: targetDoc,
          assigneeUser: ctx.user,
          filename: safeName,
          tgMeta,
          buf,
          mime,
          note: cleanNote,
          doneAt: nowT,
        });
      }

      return repo.attachmentById(attId);
    },

    async downloadAttachment(user, attachmentId) {
      const att = await repo.attachmentBlobById(attachmentId);
      if (!att) throw notFound('Fayl topilmadi');
      await loadVisibleDoc(user, att.doc_id);
      const buf = await resolveAttachmentBuffer(att);
      return new Reply(200, buf, {
        raw: true,
        headers: {
          'Content-Type': att.mime_type || 'application/octet-stream',
          'Content-Disposition': contentDisposition(att.orig_name),
        },
      });
    },

    async previewAttachment(user, attachmentId) {
      const att = await repo.attachmentBlobById(attachmentId);
      if (!att) throw notFound('Fayl topilmadi');
      await loadVisibleDoc(user, att.doc_id);
      const buf = await resolveAttachmentBuffer(att);
      const ext = fileExt(att.orig_name);
      const base = { id: att.id, orig_name: att.orig_name, mime_type: att.mime_type, size_bytes: att.size_bytes };
      if (ext === '.xlsx') {
        const parsed = previewXlsx(buf);
        if (parsed) return { ...base, ...parsed };
      } else if (ext === '.docx') {
        const parsed = previewDocx(buf);
        if (parsed) return { ...base, ...parsed };
      } else if (ext === '.txt' || ext === '.csv') {
        return { ...base, kind: 'text', text: buf.toString('utf8').slice(0, 200_000) };
      }
      return { ...base, kind: 'binary' };
    },

    async createViewTicket(user, attachmentId) {
      const att = await repo.attachmentById(attachmentId);
      if (!att) throw notFound('Fayl topilmadi');
      await loadVisibleDoc(user, att.doc_id);
      const t = now().getTime();
      for (const [k, v] of viewTickets) if (v.expiresAt < t) viewTickets.delete(k);
      const ticket = randomUUID();
      viewTickets.set(ticket, { attachmentId: att.id, expiresAt: t + 60_000 });
      return { ticket, orig_name: att.orig_name, mime_type: att.mime_type, size_bytes: att.size_bytes };
    },

    async serveViewTicket(ticket) {
      const entry = viewTickets.get(ticket);
      if (!entry || entry.expiresAt < now().getTime()) {
        viewTickets.delete(ticket);
        throw notFound('Ko\u02bbrish chiptasi eskirgan, qayta oching');
      }
      const att = await repo.attachmentBlobById(entry.attachmentId);
      if (!att) throw notFound('Fayl topilmadi');
      const buf = await resolveAttachmentBuffer(att);
      const rawMime = String(att.mime_type || 'application/octet-stream').toLowerCase();
      const baseMime = rawMime.split(';')[0].trim();
      const safeInline = SAFE_INLINE_MIMES.has(baseMime);
      return new Reply(200, buf, {
        raw: true,
        headers: {
          'Content-Type': att.mime_type || 'application/octet-stream',
          'Content-Disposition': contentDisposition(att.orig_name, safeInline ? 'inline' : 'attachment'),
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
        },
      });
    },

    async deleteAttachment(ctx, attachmentId) {
      requireAdmin(ctx.user);
      const att = await repo.attachmentById(attachmentId);
      if (!att) throw notFound('Fayl topilmadi');
      await repo.deleteAttachment(attachmentId);
      await audit(repo, ctx, 'file_delete', 'attachment', attachmentId, { doc_id: att.doc_id, filename: att.orig_name });
      return { ok: true };
    },

    // ---- topshiriqlar ----
    async assign(ctx, taskId, userId) {
      requireManager(ctx.user);
      const task = await repo.taskById(taskId);
      if (!task) throw notFound('Topshiriq topilmadi');
      const u = await activeUserOrThrow(userId, { executor: true, message: 'Bajaruvchi noto\u02bbg\u02bbri' });
      if (await repo.assigneeExists(taskId, u.id)) throw conflict('Allaqachon biriktirilgan');
      const t = today();
      const id = await mapUnique(() => tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        const aid = await trepo.insertAssignee({ task_id: taskId, user_id: u.id, assigned_by: ctx.user.id, assigned_at: t });
        await trepo.enqueueSmsPhone({ to: u.name, phone: null, text: `\u2116 ${task.doc_number} nazorat varaqasi sizga biriktirildi`, at: t });
        await addEvent(trepo, task.doc_id, ctx.user.id, 'assigned', { to: u.id, to_name: u.name, task_id: taskId });
        await notify(trepo, u.id, 'new_task', `Yangi topshiriq: \u2116 ${task.doc_number}`, task.title, task.doc_id);
        await audit(trepo, ctx, 'task_assign', 'task', taskId, { user_id: u.id });
        return aid;
      }), 'Allaqachon biriktirilgan');

      const docFiles = await repo.attachmentsByDoc(task.doc_id, 'document');
      await notifyAssignmentTelegram({
        assigneeUser: u,
        docNumber: task.doc_number,
        docTitle: task.doc_title || task.title,
        deadline: task.deadline,
        docFiles,
      });

      return { id, task_id: taskId, user_id: u.id, assigned_by: ctx.user.id, assigned_at: t, done_date: null };
    },

    async delegate(ctx, assigneeId, toUserId, note) {
      const a = await repo.assigneeById(assigneeId);
      if (!a) throw notFound('Topilmadi');
      const own = ctx.user.role === 'user' && a.user_id === ctx.user.id;
      if (!isManager(ctx.user) && !own) throw forbidden('Ruxsat yo\u02bbq');
      const toUser = await repo.userById(toUserId);
      if (!toUser || !toUser.active) throw unprocessable('Bajaruvchi topilmadi yoki faol emas');
      if (toUser.role !== 'user' || toUser.code === 'U001') {
        throw unprocessable('Topshiriqni faqat faol oddiy xodimga uzatish mumkin');
      }
      if (toUser.id === a.user_id || toUser.id === ctx.user.id) {
        throw unprocessable('Topshiriqni o\u02bbzingizga yoki joriy bajaruvchiga uzata olmaysiz');
      }
      const nowT = nowIso();
      const t = today();
      await tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        await trepo.delegate(assigneeId, toUserId, note, nowT);
        if (!(await trepo.assigneeExists(a.task_id, toUserId))) {
          await trepo.insertAssignee({ task_id: a.task_id, user_id: toUserId, assigned_by: ctx.user.id, assigned_at: t });
        }
        const task = await trepo.taskById(a.task_id);
        if (task) {
          await addEvent(trepo, task.doc_id, ctx.user.id, 'delegated', { from: a.user_id, to: toUserId, note });
          await notify(trepo, toUserId, 'delegated', `Topshiriq uzatildi: \u2116 ${task.doc_number}`, note || task.title, task.doc_id);
        }
        await audit(trepo, ctx, 'task_delegate', 'assignee', assigneeId, { to: toUserId, note });
      });

      const docFiles = await repo.attachmentsByDoc(a.doc_id, 'document');
      await notifyAssignmentTelegram({
        assigneeUser: toUser,
        docNumber: a.doc_number,
        docTitle: a.doc_title || a.task_title,
        deadline: a.deadline,
        docFiles,
      });

      return { ok: true, delegated_to: toUserId, delegated_to_name: toUser.name };
    },

    async markViewed(ctx, assigneeId) {
      const a = await repo.assigneeById(assigneeId);
      if (!a) throw notFound('Topilmadi');
      if (a.user_id !== ctx.user.id && !isManager(ctx.user)) throw forbidden('Ruxsat yo\u02bbq');
      const nowT = nowIso();
      await repo.setViewed(assigneeId, a.user_id, nowT);
      if (a.task_id) {
        const task = await repo.taskById(a.task_id);
        if (task) await addEvent(repo, task.doc_id, ctx.user.id, 'viewed_assignee', { assignee_id: assigneeId });
      }
      return { ok: true, viewed_at: nowT };
    },

    async setDone(ctx, assigneeId, doneDate, note = undefined) {
      const a = await repo.assigneeById(assigneeId);
      if (!a) throw notFound('Topilmadi');
      if (a.user_id !== ctx.user.id) throw forbidden('Topshiriqni faqat bajaruvchi xodimning o\u02bbzi yakunlashi mumkin');
      if (doneDate !== null) {
        if (doneDate < a.doc_created_at) throw unprocessable('Sana hujjat yaratilgan sanadan oldin bo\u02bblishi mumkin emas');
        if (doneDate > today()) throw unprocessable('Kelajak sanasi mumkin emas');
      }
      const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : undefined;
      const doneAt = doneDate ? nowIso() : null;
      await repo.setDone(assigneeId, doneDate, cleanNote, doneAt);
      if (doneDate && a.task_id) {
        const task = await repo.taskById(a.task_id);
        if (task) {
          const onTime = doneDate <= task.deadline;
          await addEvent(repo, task.doc_id, ctx.user.id, onTime ? 'completed' : 'completed_late', { done_date: doneDate, deadline: task.deadline, note: cleanNote ?? null });
        }
      }
      await audit(repo, ctx, 'task_done', 'assignee', assigneeId, { done_date: doneDate });
      return { id: assigneeId, done_date: doneDate, completion_note: cleanNote ?? a.completion_note ?? null };
    },

    async deleteTask(ctx, taskId) {
      requireAdmin(ctx.user);
      const task = await repo.taskById(taskId);
      if (!task) throw notFound('Topshiriq topilmadi');
      await tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        await trepo.deleteTask(taskId);
        await addEvent(trepo, task.doc_id, ctx.user.id, 'task_deleted', { task_id: taskId, title: task.title });
        await audit(trepo, ctx, 'task_delete', 'task', taskId, { doc_id: task.doc_id, title: task.title });
      });
    },

    async deleteAssignee(ctx, assigneeId) {
      requireAdmin(ctx.user);
      const a = await repo.assigneeById(assigneeId);
      if (!a) throw notFound('Bajaruvchi topilmadi');
      const target = await repo.userById(a.user_id);
      await tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        await trepo.clearDelegationTarget(a.task_id, a.user_id);
        await trepo.deleteAssignee(assigneeId);
        await addEvent(trepo, a.doc_id, ctx.user.id, 'unassigned', { task_id: a.task_id, user_id: a.user_id, user_name: target?.name || null });
        await audit(trepo, ctx, 'assignee_delete', 'assignee', assigneeId, { doc_id: a.doc_id, task_id: a.task_id, user_id: a.user_id });
      });
    },

    async listTasks(user, f) {
      checkPeriod(f);
      let items = (await scopedTasks(user, f)).filter((x) => inPeriod(x, f.year, f.month));
      if (f.status) items = items.filter((x) => x.status === f.status);
      items.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      return paginate(items, f.page, f.per_page);
    },

    async stats(user, f) {
      checkPeriod(f);
      const year = f.year || Number(today().slice(0, 4));
      let items = (await scopedTasks(user, f)).filter((x) => inPeriod(x, year, f.month));
      if (f.status) items = items.filter((x) => x.status === f.status);
      return { year, month: f.month || null, ...summarize(items) };
    },

    // ---- Excel / Word hisobot eksporti ----
    async exportReport(user, f, format) {
      checkPeriod(f);
      const filterStatus = (list) => (f.status ? list.filter((x) => x.status === f.status) : list);

      const baseItems = await scopedTasks(user, f);
      const items = filterStatus(baseItems.filter((x) => inPeriod(x, f.year, f.month)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

      const [orgsList, usersList] = await Promise.all([repo.listOrgs(), repo.listUsers()]);
      const orgMap = new Map(orgsList.map((o) => [o.id, o.name]));
      const userMap = new Map(usersList.map((u) => [u.id, u.name]));
      const summary = summarize(items);
      const yearlySummary = f.year && f.month
        ? summarize(filterStatus(baseItems.filter((x) => inPeriod(x, f.year, null))))
        : null;
      const docCount = new Set(items.map((x) => x.doc_id)).size;

      const byOrg = new Map();
      const byUser = new Map();
      for (const item of items) {
        if (!byOrg.has(item.org_id)) byOrg.set(item.org_id, []);
        byOrg.get(item.org_id).push(item);
        for (const a of item.assignees) {
          if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
          byUser.get(a.user_id).push({ date: item.date, status: a.status, assignees: [a] });
        }
      }
      const orgStats = [...byOrg.entries()].map(([oid, list]) => ({
        name: orgMap.get(oid) || '—',
        ...summarize(list),
      })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      const userStats = [...byUser.entries()].map(([uid, list]) => ({
        name: userMap.get(uid) || '—',
        ...summarize(list),
      })).sort((a, b) => b.total - a.total || b.pct - a.pct || a.name.localeCompare(b.name));

      const MN = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
      const statYear = f.year || Number(today().slice(0, 4));
      const monthlyStats = MN.map((label, idx) => ({
        month: idx + 1,
        label: `${statYear}-yil ${label}`,
        ...summarize(filterStatus(baseItems.filter((x) => inPeriod(x, statYear, idx + 1)))),
      }));

      const rows = items.flatMap((t) => {
        if (!t.assignees.length) {
          return [{
            number: t.doc_number,
            type: t.doc_type,
            org: orgMap.get(t.org_id) || '—',
            department: t.department || '—',
            docTitle: t.doc_title,
            priorityLabel: PRIORITY_LABELS[t.priority] || t.priority,
            taskTitle: t.title,
            assignee: 'Biriktirilmagan',
            viewedAt: 'Koʻrilmagan',
            deadline: t.deadline,
            doneDate: '—',
            statusLabel: STATUS_LABELS[t.status] || t.status,
          }];
        }
        return t.assignees.map((a) => ({
          number: t.doc_number,
          type: t.doc_type,
          org: orgMap.get(t.org_id) || '—',
          department: t.department || '—',
          docTitle: t.doc_title,
          priorityLabel: PRIORITY_LABELS[t.priority] || t.priority,
          taskTitle: t.title,
          assignee: userMap.get(a.user_id) || '—',
          viewedAt: a.viewed_at ? formatTzDateTime(a.viewed_at, config.tz) : 'Koʻrilmagan',
          deadline: t.deadline,
          doneDate: a.done_date || '—',
          statusLabel: STATUS_LABELS[a.status] || a.status,
        }));
      });

      const periodLabel = f.year
        ? (f.month ? `${f.year}-yil ${MN[f.month - 1]}` : `${f.year}-yil`)
        : 'Barcha davr';
      const filterParts = [];
      if (f.status) filterParts.push(`Holat: ${STATUS_LABELS[f.status] || f.status}`);
      if (f.user_id) filterParts.push(`Xodim: ${userMap.get(f.user_id) || f.user_id}`);
      if (f.org_id) filterParts.push(`Tashkilot: ${orgMap.get(f.org_id) || f.org_id}`);
      if (f.q) filterParts.push(`Qidiruv: "${f.q}"`);
      const filterNote = filterParts.join(', ');
      const stamp = today();
      const generatedAt = formatTzDateTime(nowIso(), config.tz);
      const reportData = {
        title: 'Hujjat aylanish tizimi — Ijro nazorati hisoboti',
        periodLabel,
        generatedAt,
        filterNote,
        summary,
        yearlySummary,
        docCount,
        rows,
        orgStats,
        userStats,
        monthlyStats,
      };

      if (format === 'xlsx') {
        const buf = buildXlsx(reportData);
        return new Reply(200, buf, {
          raw: true,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': contentDisposition(`hujjat-hisobot-${stamp}.xlsx`),
          },
        });
      }
      const buf = buildDocx(reportData);
      return new Reply(200, buf, {
        raw: true,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': contentDisposition(`hujjat-hisobot-${stamp}.docx`),
        },
      });
    },

    // ---- foydalanuvchi boshqaruvi ----
    listUsers: async (user) => (await repo.listUsers()).map((u) => publicUser(u, user)),

    async createUserAdmin(ctx, b) {
      requireAdmin(ctx.user);
      if (!(await repo.orgById(b.org_id))) throw unprocessable('Tashkilot topilmadi');
      const cleanCode = String(b.code || '').trim();
      if (await repo.userByCodeIgnoreCase(cleanCode)) throw conflict('Bu kod allaqachon mavjud');
      if (!b.password || b.password.length < 8) throw unprocessable('Parol kamida 8 belgi bo\u02bblishi kerak');
      const id = await mapUnique(() => repo.insertUser({
        name: b.name, org_id: b.org_id, department: b.department ?? null,
        pos: b.pos, role: b.role || 'user', code: cleanCode,
        password_hash: hashPassword(b.password),
        must_change_password: b.auth_reset_required ? 1 : 0,
        telegram_chat_id: b.telegram_chat_id ? String(b.telegram_chat_id).trim() : null,
        created_at: nowIso(),
      }), 'Bu kod allaqachon mavjud');
      await audit(repo, ctx, 'user_create', 'user', id, { code: cleanCode, role: b.role });
      return publicUser(await repo.userById(id), ctx.user);
    },

    async updateUserAdmin(ctx, userId, b) {
      requireAdmin(ctx.user);
      const u = await repo.userById(userId);
      if (!u) throw notFound('Foydalanuvchi topilmadi');
      const fields = {};
      if (b.name) fields.name = b.name;
      if (b.department !== undefined) fields.department = b.department;
      if (b.pos !== undefined) fields.pos = b.pos;
      if (b.role) fields.role = b.role;
      if (b.org_id) { if (!(await repo.orgById(b.org_id))) throw unprocessable('Tashkilot topilmadi'); fields.org_id = b.org_id; }
      if (b.auth_reset_required !== undefined && !b.password) fields.must_change_password = b.auth_reset_required ? 1 : 0;
      if (Object.keys(fields).length) await repo.updateUser(userId, fields);
      if (b.telegram_chat_id !== undefined) {
        await repo.setTelegramChat(userId, b.telegram_chat_id, null);
      }
      if (b.password) {
        if (b.password.length < 8) throw unprocessable('Parol kamida 8 belgi');
        await repo.setPassword(userId, hashPassword(b.password), b.auth_reset_required ? 1 : 0);
      }
      if (b.active !== undefined) {
        await repo.setActive(userId, b.active);
        if (!b.active) await tokens.revokeAllForUser(userId);
      }
      await audit(repo, ctx, 'user_update', 'user', userId, { fields: Object.keys(fields), password_changed: !!b.password });
      return publicUser(await repo.userById(userId), ctx.user);
    },

    async setUserRole(ctx, userId, role) {
      requireAdmin(ctx.user);
      const ROLES = ['admin', 'operator', 'viewer', 'user'];
      if (!ROLES.includes(role)) throw unprocessable('Noto\u02bbg\u02bbri rol');
      const u = await repo.userById(userId);
      if (!u) throw notFound('Foydalanuvchi topilmadi');
      await repo.setRole(userId, role);
      await audit(repo, ctx, 'user_role_change', 'user', userId, { role });
      return publicUser(await repo.userById(userId), ctx.user);
    },

    async deleteUserAdmin(ctx, userId) {
      requireAdmin(ctx.user);
      if (userId === ctx.user.id) throw unprocessable('O\u02bbzingizni o\u02bbchira olmaysiz');
      const u = await repo.userById(userId);
      if (!u) throw notFound('Foydalanuvchi topilmadi');
      await tx(db, async (tdb) => {
        const trepo = createRepo(tdb);
        await trepo.deleteUser(userId, ctx.user.id);
        await audit(trepo, ctx, 'user_delete', 'user', userId, { code: u.code, name: u.name });
      });
    },

    // ---- integratsiya ----
    async getIntegrations(caller) {
      requireAdmin(caller);
      return (await repo.listIntegrations()).map((r) => ({ ...r, value: maskIntegrationSecrets(r.value) }));
    },

    async saveIntegration(ctx, key, value) {
      requireAdmin(ctx.user);
      if (!INTEGRATION_KEYS.includes(key)) throw unprocessable('Noma\u02bblum integratsiya turi');

      const prev = await repo.getIntegration(key);
      const cleanValue = value && typeof value === 'object' ? { ...value } : {};
      const isTest = Boolean(cleanValue.test_connection);
      delete cleanValue.test_connection;
      for (const f of SECRET_FIELDS) {
        delete cleanValue[`has_${f}`];
        if (!cleanValue[f] && prev?.value?.[f]) cleanValue[f] = prev.value[f];
      }
      if (cleanValue.api_url !== undefined && cleanValue.api_url !== null && String(cleanValue.api_url).trim() !== '') {
        cleanValue.api_url = await validateExternalUrl(cleanValue.api_url, isTest);
      }

      if (isTest) {
        if (key === 'sms_provider' && cleanValue.api_url && cleanValue.test_phone) {
          try {
            const headers = { 'Content-Type': 'application/json' };
            let payload;
            if (cleanValue.provider === 'eskiz' || /eskiz\.uz/i.test(cleanValue.api_url)) {
              if (cleanValue.password) headers.Authorization = `Bearer ${cleanValue.password}`;
              payload = { mobile_phone: cleanValue.test_phone.replace(/\D/g, ''), message: 'Hujjat tizimi test xabari', from: cleanValue.sender || '4546' };
            } else {
              headers.Authorization = `Basic ${Buffer.from(`${cleanValue.login || ''}:${cleanValue.password || ''}`).toString('base64')}`;
              payload = { messages: [{ recipient: cleanValue.test_phone.replace(/\D/g, ''), 'message-id': 'test-' + Date.now(), sms: { originator: cleanValue.sender || 'Test', content: { text: 'Hujjat tizimi test xabari' } } }] };
            }
            const r = await fetch(cleanValue.api_url, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
              redirect: 'error',
              signal: AbortSignal.timeout(10000),
            });
            const result = { key, status: r.ok ? 'success' : 'error', http_status: r.status, message: r.ok ? 'SMS muvaffaqiyatli yuborildi!' : `SMS yuborishda xato: HTTP ${r.status}` };
            if (r.ok) await repo.setIntegration(key, cleanValue, ctx.user.id, today());
            await audit(repo, ctx, 'integration_test', 'integration', null, { key, success: r.ok });
            return result;
          } catch (e) {
            return { key, status: 'error', message: `Ulanib bo\u02bblmadi: ${e.message}` };
          }
        }
        return { key, status: 'error', message: 'Test uchun API manzili va test raqami kiritilishi kerak' };
      }

      await repo.setIntegration(key, cleanValue, ctx.user.id, today());
      await audit(repo, ctx, 'integration_save', 'integration', null, { key });
      return { key, status: 'saved', updated_at: today() };
    },

    async deleteIntegration(ctx, key) {
      requireAdmin(ctx.user);
      if (!INTEGRATION_KEYS.includes(key)) throw unprocessable('Noma\u02bblum integratsiya turi');
      await repo.deleteIntegration(key);
      await audit(repo, ctx, 'integration_delete', 'integration', null, { key });
      return { ok: true };
    },

    // ---- bildirishnomalar ----
    listNotifications: (user) => repo.listNotifications(user.id),
    countUnread: async (user) => ({ count: await repo.countUnread(user.id) }),
    markRead: async (user, id) => { await repo.markRead(id, user.id); return { ok: true }; },
    markAllRead: async (user) => { await repo.markAllRead(user.id); return { ok: true }; },

    // ---- ma'lumotnomalar ----
    listOrgs: () => repo.listOrgs(),
    async createOrganization(ctx, { name }) {
      requireManager(ctx.user);
      if (await repo.orgByName(name)) throw conflict('Bunday nomli tashkilot allaqachon mavjud');
      const id = await mapUnique(() => repo.insertOrg(name), 'Bunday nomli tashkilot allaqachon mavjud');
      await audit(repo, ctx, 'org_create', 'organization', id, { name });
      return repo.orgById(id);
    },
    async listSms(user) { requireManager(user); return repo.listSms(); },
    async listAudit(user, { page, per_page }) {
      requireAdmin(user);
      const { rows, total } = await repo.listAudit({ limit: per_page, offset: (page - 1) * per_page });
      return { data: rows, meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } };
    },

    // ---- demo tozalash ----
    async clearDemo(ctx) {
      requireAdmin(ctx.user);
      const count = await repo.countDocs();
      if (count === 0) return { deleted: 0, message: 'Hujjatlar allaqachon bo\u02bbsh' };
      await repo.clearDemoData(ctx.user.id);
      return { deleted: count, message: `${count} ta hujjat va barcha tegishli ma\u02bblumotlar o\u02bbchirildi` };
    },
  };
}
