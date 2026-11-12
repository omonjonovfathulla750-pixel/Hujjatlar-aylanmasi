// Barcha API endpointlari bir joyda. Sxemalar validatsiya va OpenAPI hujjati uchun ishlatiladi.
import { Reply } from './errors.js';

export const DOC_TYPES = ['Nazorat varaqasi', 'Xat', 'Buyruq', 'Farmoyish'];
const TASK_STATUSES = ['late', 'prog', 'new', 'ok'];
const DOC_STATUSES = ['signing', 'signed', 'sent'];
const MANAGERS = ['admin', 'operator'];
const MAX_UPLOAD_BODY = 15 * 1024 * 1024;

const page = { type: 'integer', minimum: 1 };
const perPage = { type: 'integer', minimum: 1, maximum: 100 };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'integer', minimum: 1 };

const schemas = {
  login: obj({
    id: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 200, trim: false },
  }, ['id', 'password']),
  refresh: obj({ refresh_token: { type: 'string', minLength: 1, maxLength: 4000 } }, ['refresh_token']),
  logout: obj({ refresh_token: { type: 'string', minLength: 1, maxLength: 4000 } }),
  changePassword: obj({
    current_password: { type: 'string', minLength: 1, maxLength: 200, trim: false },
    new_password: { type: 'string', minLength: 8, maxLength: 200, trim: false },
  }, ['current_password', 'new_password']),
  registerEmployee: obj({
    full_name: { type: 'string', minLength: 2, maxLength: 200 },
    position: { type: 'string', minLength: 2, maxLength: 200 },
    login: { type: 'string', minLength: 2, maxLength: 64 },
    password: { type: 'string', minLength: 8, maxLength: 200, trim: false },
    password_confirm: { type: 'string', minLength: 1, maxLength: 200, trim: false },
    org_id: id,
    department: { type: 'string', maxLength: 200, nullable: true },
  }, ['full_name', 'position', 'login', 'password']),
  docCreate: obj({
    number: { type: 'string', minLength: 1, maxLength: 50 },
    type: { type: 'string', enum: DOC_TYPES },
    org_id: id,
    department: { type: 'string', maxLength: 200, nullable: true },
    deadline: { type: 'string', format: 'date' },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    assignee: { type: 'integer', minimum: 1, nullable: true },
    signers: { type: 'array', maxItems: 20, items: id },
    priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
  }, ['number', 'type', 'org_id', 'deadline', 'title']),
  docPatch: obj({
    number: { type: 'string', minLength: 1, maxLength: 50 },
    type: { type: 'string', enum: DOC_TYPES },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    org_id: id,
    department: { type: 'string', maxLength: 200, nullable: true },
    priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
  }),
  send: obj({ org_id: id }, ['org_id']),
  assign: obj({ user_id: id }, ['user_id']),
  done: obj({
    done_date: { type: 'string', format: 'date', nullable: true },
    note: { type: 'string', maxLength: 1000, nullable: true },
  }, ['done_date']),
  fileUpload: obj({
    filename: { type: 'string', minLength: 1, maxLength: 200 },
    mime_type: { type: 'string', maxLength: 120 },
    data_base64: { type: 'string', minLength: 1, maxLength: MAX_UPLOAD_BODY },
    note: { type: 'string', maxLength: 1000, nullable: true },
  }, ['filename', 'data_base64']),
  telegramLink: obj({
    init_data: { type: 'string', maxLength: 8000 },
    chat_id: { type: 'string', maxLength: 64, nullable: true },
  }),
  telegramWebhook: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  docsQuery: obj({
    q: { type: 'string', maxLength: 100 },
    status: { type: 'string', enum: TASK_STATUSES },
    doc_status: { type: 'string', enum: DOC_STATUSES },
    org_id: id,
    date_from: { type: 'string', format: 'date' },
    date_to: { type: 'string', format: 'date' },
    page, per_page: perPage,
  }),
  tasksQuery: obj({
    status: { type: 'string', enum: TASK_STATUSES },
    year: { type: 'integer', minimum: 2000, maximum: 2100 },
    month: { type: 'integer', minimum: 1, maximum: 12 },
    doc_id: id,
    user_id: id,
    org_id: id,
    q: { type: 'string', maxLength: 100 },
    page, per_page: perPage,
  }),
  statsQuery: obj({
    status: { type: 'string', enum: TASK_STATUSES },
    year: { type: 'integer', minimum: 2000, maximum: 2100 },
    month: { type: 'integer', minimum: 1, maximum: 12 },
    user_id: id,
    org_id: id,
  }),
  exportQuery: obj({
    status: { type: 'string', enum: TASK_STATUSES },
    year: { type: 'integer', minimum: 2000, maximum: 2100 },
    month: { type: 'integer', minimum: 1, maximum: 12 },
    org_id: id,
    user_id: id,
    doc_id: id,
    q: { type: 'string', maxLength: 100 },
  }),
  pageQuery: obj({ page, per_page: perPage }),
  integrationBody: obj({
    provider: { type: 'string', maxLength: 50 },
    api_url: { type: 'string', maxLength: 500 },
    login: { type: 'string', maxLength: 200 },
    password: { type: 'string', maxLength: 500, trim: false },
    sender: { type: 'string', maxLength: 100 },
    test_phone: { type: 'string', maxLength: 50 },
    enabled: { type: 'boolean' },
    test_connection: { type: 'boolean' },
    token: { type: 'string', maxLength: 500, trim: false },
    bot_token: { type: 'string', maxLength: 500, trim: false },
    chat_id: { type: 'string', maxLength: 100 },
  }),
};

const withDefaults = (q) => ({ page: 1, per_page: 20, ...q });

export function buildRoutes({ svc, repo, version, startedAt = Date.now() }) {
  return [
    // ---------- tizim ----------
    {
      method: 'GET', path: '/health', auth: false, tags: ['Tizim'], summary: 'Sogʻliq tekshiruvi (healthcheck)',
      async handler() {
        let dbOk = false;
        try { dbOk = await repo.ping(); } catch { dbOk = false; }
        const body = { status: dbOk ? 'ok' : 'error', db: dbOk ? 'ok' : 'error', version, uptime_sec: Math.round((Date.now() - startedAt) / 1000) };
        return new Reply(dbOk ? 200 : 503, body);
      },
    },

    // ---------- autentifikatsiya ----------
    {
      method: 'POST', path: '/auth/login', auth: false, rateLimit: 'login', tags: ['Autentifikatsiya'],
      summary: 'Kirish: ID va parol bilan access + refresh token olish', body: schemas.login,
      handler: ({ body, ctx }) => svc.login(ctx, body),
    },
    {
      method: 'POST', path: '/auth/refresh', auth: false, tags: ['Autentifikatsiya'],
      summary: 'Refresh token orqali yangi token juftligi olish (rotation)', body: schemas.refresh,
      handler: ({ body, ctx }) => svc.refresh(ctx, body.refresh_token),
    },
    {
      method: 'POST', path: '/auth/logout', auth: false, tags: ['Autentifikatsiya'],
      summary: 'Chiqish: refresh tokenni bekor qilish', body: schemas.logout,
      handler: ({ body, ctx }) => svc.logout(ctx, body.refresh_token),
    },
    {
      method: 'POST', path: '/auth/change-password', tags: ['Autentifikatsiya'],
      summary: 'Xodim oʻz parolini mustaqil oʻzgartirishi', body: schemas.changePassword,
      handler: ({ body, ctx }) => svc.changeOwnPassword(ctx, body),
    },
    {
      method: 'POST', path: '/auth/register-employee', status: 201, tags: ['Autentifikatsiya'],
      summary: 'U001 shabloni orqali yangi xodimni roʻyxatdan oʻtkazish va shaxsiy profilga kirish', body: schemas.registerEmployee,
      handler: ({ body, ctx }) => svc.registerEmployee(ctx, body),
    },
    {
      method: 'GET', path: '/auth/me', tags: ['Autentifikatsiya'], summary: 'Joriy foydalanuvchi',
      handler: ({ user }) => svc.me(user),
    },

    // ---------- UI uchun ----------
    {
      method: 'GET', path: '/data', tags: ['Tizim'],
      summary: 'Veb-ilova uchun boshlangʻich maʼlumotlar paketi (hujjatlar, xodimlar, tashkilotlar)',
      handler: ({ user }) => svc.bootstrap(user),
    },

    // ---------- hujjatlar ----------
    {
      method: 'GET', path: '/documents', tags: ['Hujjatlar'], summary: 'Hujjatlar roʻyxati (filtr, qidiruv, sahifalash)',
      query: schemas.docsQuery,
      handler: ({ user, query }) => svc.listDocuments(user, withDefaults(query)),
    },
    {
      method: 'POST', path: '/documents', status: 201, roles: MANAGERS, tags: ['Hujjatlar'], summary: 'Yangi hujjat yaratish',
      body: schemas.docCreate,
      handler: ({ body, ctx }) => svc.createDocument(ctx, body),
    },
    {
      method: 'GET', path: '/documents/:id', tags: ['Hujjatlar'], summary: 'Bitta hujjat (topshiriqlar, imzolar, almashinuvlar, fayllar bilan)',
      handler: ({ user, params }) => svc.getDocument(user, params.id),
    },
    {
      method: 'PATCH', path: '/documents/:id', roles: MANAGERS, tags: ['Hujjatlar'], summary: 'Hujjat maydonlarini oʻzgartirish',
      body: schemas.docPatch,
      handler: ({ body, params, ctx }) => svc.updateDocument(ctx, params.id, body),
    },
    {
      method: 'DELETE', path: '/documents/:id', status: 204, roles: ['admin'], tags: ['Hujjatlar'], summary: 'Hujjatni oʻchirish (faqat admin)',
      async handler({ params, ctx }) { await svc.deleteDocument(ctx, params.id); return new Reply(204); },
    },
    {
      method: 'POST', path: '/documents/:id/sign', tags: ['Hujjatlar'], summary: 'Hujjatni imzolash (faqat imzolovchining oʻzi)',
      handler: ({ params, ctx }) => svc.sign(ctx, params.id),
    },
    {
      method: 'POST', path: '/documents/:id/send', roles: MANAGERS, tags: ['Hujjatlar'], summary: 'Hujjatni boshqa tashkilotga yuborish',
      body: schemas.send,
      handler: ({ body, params, ctx }) => svc.send(ctx, params.id, body.org_id),
    },

    // ---------- fayllar ----------
    {
      method: 'POST', path: '/documents/:id/files', status: 201, roles: MANAGERS, tags: ['Fayllar'],
      summary: 'Hujjatga fayl biriktirish (PDF, Word, Excel, rasm)', allowMultipart: true, maxBodyBytes: MAX_UPLOAD_BODY, body: schemas.fileUpload,
      handler: ({ body, params, ctx }) => svc.uploadAttachment(ctx, { docId: params.id, kind: 'document', ...body }),
    },
    {
      method: 'POST', path: '/assignees/:id/files', status: 201, tags: ['Fayllar'],
      summary: 'Bajarilgan topshiriqqa javob faylini yuklash (majburiy tavsif bilan)', allowMultipart: true, maxBodyBytes: MAX_UPLOAD_BODY, body: schemas.fileUpload,
      handler: ({ body, params, ctx }) => svc.uploadAttachment(ctx, { assigneeId: params.id, kind: 'response', ...body }),
    },
    {
      method: 'GET', path: '/attachments/:id/preview', tags: ['Fayllar'],
      summary: 'Biriktirilgan fayl mazmunini (Excel, Word, matn) koʻrish',
      handler: ({ user, params }) => svc.previewAttachment(user, params.id),
    },
    {
      method: 'POST', path: '/attachments/:id/ticket', tags: ['Fayllar'],
      summary: 'Faylni dastur ichida koʻrish uchun qisqa muddatli chipta olish',
      handler: ({ user, params }) => svc.createViewTicket(user, params.id),
    },
    {
      method: 'GET', path: '/attachments/:id/download', tags: ['Fayllar'],
      summary: 'Biriktirilgan faylni yuklab olish',
      handler: ({ user, params }) => svc.downloadAttachment(user, params.id),
    },
    {
      method: 'DELETE', path: '/attachments/:id', status: 204, roles: ['admin'], tags: ['Fayllar'],
      summary: 'Biriktirilgan faylni oʻchirish (faqat admin)',
      handler: ({ params, ctx }) => svc.deleteAttachment(ctx, params.id),
    },

    // ---------- topshiriqlar ----------
    {
      method: 'GET', path: '/tasks', tags: ['Topshiriqlar'], summary: 'Topshiriqlar roʻyxati (holat, davr, xodim, tashkilot boʻyicha filtr)',
      query: schemas.tasksQuery,
      handler: ({ user, query }) => svc.listTasks(user, withDefaults(query)),
    },
    {
      method: 'DELETE', path: '/tasks/:id', status: 204, roles: ['admin'], tags: ['Topshiriqlar'],
      summary: 'Topshiriqni oʻchirish (faqat admin)',
      async handler({ params, ctx }) { await svc.deleteTask(ctx, params.id); return new Reply(204); },
    },
    {
      method: 'POST', path: '/tasks/:id/assignees', status: 201, roles: MANAGERS, tags: ['Topshiriqlar'],
      summary: 'Topshiriqqa bajaruvchi biriktirish', body: schemas.assign,
      handler: ({ body, params, ctx }) => svc.assign(ctx, params.id, body.user_id),
    },
    {
      method: 'PATCH', path: '/assignees/:id', tags: ['Topshiriqlar'],
      summary: 'Bajarilgan sanani belgilash yoki bekor qilish (done_date: null)', body: schemas.done,
      handler: ({ body, params, ctx }) => svc.setDone(ctx, params.id, body.done_date, body.note),
    },
    {
      method: 'DELETE', path: '/assignees/:id', status: 204, roles: ['admin'], tags: ['Topshiriqlar'],
      summary: 'Xodimga yuklangan vazifani bekor qilish (faqat admin)',
      async handler({ params, ctx }) { await svc.deleteAssignee(ctx, params.id); return new Reply(204); },
    },

    // ---------- maʼlumotnomalar va hisobotlar ----------
    {
      method: 'GET', path: '/users', tags: ['Maʼlumotnomalar'], summary: 'Xodimlar roʻyxati (ID kodlarini faqat admin koʻradi)',
      handler: ({ user }) => ({ data: svc.listUsers(user) }),
    },
    {
      method: 'GET', path: '/organizations', tags: ['Maʼlumotnomalar'], summary: 'Tashkilotlar roʻyxati',
      handler: () => ({ data: svc.listOrgs() }),
    },
    {
      method: 'POST', path: '/organizations', status: 201, roles: MANAGERS, tags: ['Maʼlumotnomalar'],
      summary: 'Yangi tashkilot qoʻshish',
      body: obj({ name: { type: 'string', minLength: 2, maxLength: 200 } }, ['name']),
      handler: ({ body, ctx }) => svc.createOrganization(ctx, body),
    },
    {
      method: 'GET', path: '/stats/summary', tags: ['Hisobotlar'], summary: 'Topshiriqlar statistikasi (yil/oy boʻyicha)',
      query: schemas.statsQuery,
      handler: ({ user, query }) => svc.stats(user, query),
    },
    {
      method: 'GET', path: '/reports/export.xlsx', tags: ['Hisobotlar'], summary: 'Excel (.xlsx) formatida hisobot yuklab olish',
      query: schemas.exportQuery,
      handler: ({ user, query }) => svc.exportReport(user, query, 'xlsx'),
    },
    {
      method: 'GET', path: '/reports/export.docx', tags: ['Hisobotlar'], summary: 'Word (.docx) formatida hisobot yuklab olish',
      query: schemas.exportQuery,
      handler: ({ user, query }) => svc.exportReport(user, query, 'docx'),
    },
    {
      method: 'GET', path: '/sms', roles: MANAGERS, tags: ['Hisobotlar'], summary: 'SMS navbati',
      handler: ({ user }) => ({ data: svc.listSms(user) }),
    },
    {
      method: 'GET', path: '/audit', roles: ['admin'], tags: ['Hisobotlar'], summary: 'Audit jurnali (faqat admin)',
      query: schemas.pageQuery,
      handler: ({ user, query }) => svc.listAudit(user, withDefaults(query)),
    },

    // ---- Hayot sikli ----
    {
      method: 'GET', path: '/documents/:id/timeline', tags: ['Hujjatlar'], summary: 'Hujjat hayot sikli (kimga biriktirildi, koʻrdi, yakunladi)',
      handler: ({ user, params }) => svc.getDocumentTimeline(user, params.id),
    },

    // ---- Delegatsiya ----
    {
      method: 'POST', path: '/assignees/:id/delegate', tags: ['Topshiriqlar'], summary: 'Topshiriqni boshqa xodimga uzatish',
      body: obj({ user_id: id, note: { type: 'string', maxLength: 500 } }, ['user_id']),
      handler: ({ body, params, ctx }) => svc.delegate(ctx, params.id, body.user_id, body.note),
    },
    {
      method: 'POST', path: '/assignees/:id/viewed', tags: ['Topshiriqlar'], summary: 'Topshiriqni koʻrilgan deb belgilash',
      handler: ({ params, ctx }) => svc.markViewed(ctx, params.id),
    },

    // ---- Foydalanuvchi boshqaruvi (admin) ----
    {
      method: 'POST', path: '/users', status: 201, roles: ['admin'], tags: ['Foydalanuvchilar'], summary: 'Yangi xodim qoʻshish',
      body: obj({
        name: { type: 'string', minLength: 2, maxLength: 200 },
        org_id: id,
        department: { type: 'string', maxLength: 200, nullable: true },
        pos: { type: 'string', maxLength: 200 },
        role: { type: 'string', enum: ['admin', 'operator', 'viewer', 'user'] },
        code: { type: 'string', minLength: 2, maxLength: 50 },
        password: { type: 'string', minLength: 8, maxLength: 200, trim: false },
        auth_reset_required: { type: 'boolean' },
        telegram_chat_id: { type: 'string', maxLength: 64, nullable: true },
      }, ['name', 'org_id', 'code', 'password']),
      handler: ({ body, ctx }) => svc.createUserAdmin(ctx, body),
    },
    {
      method: 'PATCH', path: '/users/:id', roles: ['admin'], tags: ['Foydalanuvchilar'], summary: 'Xodim maʼlumotlarini yangilash (parol, rol, holat)',
      body: obj({
        name: { type: 'string', minLength: 2, maxLength: 200 },
        department: { type: 'string', maxLength: 200, nullable: true },
        pos: { type: 'string', maxLength: 200 },
        role: { type: 'string', enum: ['admin', 'operator', 'viewer', 'user'] },
        org_id: id,
        password: { type: 'string', minLength: 8, maxLength: 200, trim: false },
        active: { type: 'boolean' },
        auth_reset_required: { type: 'boolean' },
        telegram_chat_id: { type: 'string', maxLength: 64, nullable: true },
      }),
      handler: ({ body, params, ctx }) => svc.updateUserAdmin(ctx, params.id, body),
    },
    {
      method: 'DELETE', path: '/users/:id', status: 204, roles: ['admin'], tags: ['Foydalanuvchilar'], summary: 'Xodimni tizimdan oʻchirish (faqat admin)',
      async handler({ params, ctx }) { await svc.deleteUserAdmin(ctx, params.id); return new Reply(204); },
    },

    // ---- Integratsiyalar ----
    {
      method: 'GET', path: '/integrations', roles: ['admin'], tags: ['Integratsiya'], summary: 'Barcha integratsiya sozlamalari',
      handler: ({ user }) => ({ data: svc.getIntegrations(user) }),
    },
    {
      method: 'POST', path: '/integrations/:key', roles: ['admin'], tags: ['Integratsiya'], summary: 'Integratsiya saqlash yoki test qilish',
      body: schemas.integrationBody,
      handler: async ({ body, params, ctx }) => svc.saveIntegration(ctx, params.key, body),
    },
    {
      method: 'DELETE', path: '/integrations/:key', status: 204, roles: ['admin'], tags: ['Integratsiya'], summary: 'Integratsiyani oʻchirish',
      handler: ({ params, ctx }) => svc.deleteIntegration(ctx, params.key),
    },

    // ---- Bildirishnomalar ----
    {
      method: 'GET', path: '/notifications', tags: ['Bildirishnomalar'], summary: 'Bildirishnomalar roʻyxati',
      handler: async ({ user }) => ({ data: await svc.listNotifications(user) }),
    },
    {
      method: 'GET', path: '/notifications/unread', tags: ['Bildirishnomalar'], summary: 'Oʻqilmagan bildirishnomalar soni',
      handler: ({ user }) => svc.countUnread(user),
    },
    {
      method: 'POST', path: '/notifications/:id/read', tags: ['Bildirishnomalar'], summary: 'Bildirishnomani oʻqilgan deb belgilash',
      handler: ({ user, params }) => svc.markRead(user, params.id),
    },
    {
      method: 'POST', path: '/notifications/read-all', tags: ['Bildirishnomalar'], summary: 'Barcha bildirishnomalarni oʻqilgan deb belgilash',
      handler: ({ user }) => svc.markAllRead(user),
    },

    // ---- Arxiv va Telegram ----
    {
      method: 'GET', path: '/archive', tags: ['Arxiv'], summary: 'Arxivlangan hujjatlar, javob fayllari va iqtiboslar roʻyxati',
      handler: ({ user }) => svc.listArchive(user),
    },
    {
      method: 'GET', path: '/auth/telegram-link', tags: ['Telegram'], summary: 'Telegram botni shaxsiy profilga bogʻlash havolasi',
      handler: ({ user }) => svc.getTelegramLink(user),
    },
    {
      method: 'POST', path: '/auth/telegram-link', tags: ['Telegram'], summary: 'Telegram WebApp initData orqali profilni bogʻlash',
      body: schemas.telegramLink,
      handler: ({ ctx, body }) => svc.linkTelegram(ctx, body),
    },
    {
      method: 'POST', path: '/telegram/webhook', auth: false, tags: ['Telegram'], summary: 'Telegram Bot Webhook qabul qiluvchisi',
      maxBodyBytes: 1_000_000, body: schemas.telegramWebhook,
      handler: ({ body, headers }) => svc.handleTelegramWebhook(body, headers),
    },

    // ---- Demo tozalash ----
    {
      method: 'POST', path: '/admin/clear-demo', roles: ['admin'], tags: ['Admin'], summary: 'Demo maʼlumotlarni tozalash',
      handler: ({ ctx }) => svc.clearDemo(ctx),
    },
  ];
}

