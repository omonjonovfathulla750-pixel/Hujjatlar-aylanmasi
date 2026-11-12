// Telegram Bot API va Maxfiy Kanal Cloud Arxivi integratsiyasi.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TG_API = 'https://api.telegram.org';
const TIMEOUT_MS = 20_000;

export function createTelegramService({ config, logger, fetchImpl = fetch }) {
  const botToken = config.botToken || '';
  const archiveChatId = config.archiveChatId || '';
  const appUrl = config.appUrl || '';
  const linkSecret = config.jwtSecret || botToken || 'tg-link-fallback';

  let cachedBot = null;

  const hasBot = () => Boolean(botToken);
  const hasArchive = () => Boolean(botToken && archiveChatId);

  async function callApi(method, { json = null, form = null } = {}) {
    if (!botToken) throw new Error('BOT_TOKEN sozlanmagan');
    const url = `${TG_API}/bot${botToken}/${method}`;
    const init = { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (form) {
      init.body = form;
    } else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(json || {});
    }
    const res = await fetchImpl(url, init);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(`Telegram ${method} xatosi (${res.status}): ${data?.description || 'javob xatosi'}`);
    }
    return data.result;
  }

  async function getMe() {
    if (!botToken) return null;
    if (cachedBot) return cachedBot;
    try {
      const me = await callApi('getMe');
      cachedBot = me;
      return me;
    } catch (e) {
      logger?.warn?.('telegram_getme_failed', { error: e?.message });
      return null;
    }
  }

  async function setWebhook() {
    if (!botToken || !appUrl) return { skipped: true, reason: !botToken ? 'BOT_TOKEN yoʻq' : 'APP_URL yoʻq' };
    if (!/^https:\/\//i.test(appUrl)) {
      logger?.warn?.('telegram_webhook_skipped_non_https', { appUrl });
      return { skipped: true, reason: 'HTTPS APP_URL kerak' };
    }
    const webhookUrl = `${appUrl}/api/v1/telegram/webhook`;
    const payload = {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
    };
    if (config.tgWebhookSecret) payload.secret_token = config.tgWebhookSecret;
    const result = await callApi('setWebhook', { json: payload });
    logger?.info?.('telegram_webhook_set', { url: webhookUrl, ok: Boolean(result) });
    return { ok: true, url: webhookUrl };
  }

  function createLinkToken(userId, ttlSec = 900) {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const body = Buffer.from(JSON.stringify({ uid: Number(userId), exp })).toString('base64url');
    const sig = createHmac('sha256', linkSecret).update(body).digest('base64url').slice(0, 22);
    return `${body}.${sig}`;
  }

  function verifyLinkToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', linkSecret).update(body).digest('base64url').slice(0, 22);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!parsed?.uid || typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
      return Number(parsed.uid);
    } catch {
      return null;
    }
  }

  // Telegram WebApp initData imzosini tekshirish
  function verifyWebAppInitData(initData) {
    if (!botToken || !initData || typeof initData !== 'string') return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    const pairs = [];
    for (const [k, v] of params.entries()) {
      if (k !== 'hash') pairs.push(`${k}=${v}`);
    }
    pairs.sort();
    const checkString = pairs.join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calcHash = createHmac('sha256', secretKey).update(checkString).digest('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(calcHash, 'hex');
    if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const userObj = JSON.parse(params.get('user') || 'null');
      return userObj?.id ? userObj : null;
    } catch {
      return null;
    }
  }

  function extractTelegramFileMeta(msg, fallbackName, fallbackMime, fallbackSize) {
    if (msg?.document) {
      return {
        file_id: msg.document.file_id,
        file_name: msg.document.file_name || fallbackName,
        mime_type: msg.document.mime_type || fallbackMime,
        file_size: Number(msg.document.file_size ?? fallbackSize),
        message_id: msg.message_id,
        chat_id: String(msg.chat?.id ?? archiveChatId),
      };
    }
    if (Array.isArray(msg?.photo) && msg.photo.length) {
      const best = msg.photo[msg.photo.length - 1];
      return {
        file_id: best.file_id,
        file_name: fallbackName,
        mime_type: fallbackMime,
        file_size: Number(best.file_size ?? fallbackSize),
        message_id: msg.message_id,
        chat_id: String(msg.chat?.id ?? archiveChatId),
      };
    }
    const media = msg?.video || msg?.audio || msg?.voice;
    if (media?.file_id) {
      return {
        file_id: media.file_id,
        file_name: media.file_name || fallbackName,
        mime_type: media.mime_type || fallbackMime,
        file_size: Number(media.file_size ?? fallbackSize),
        message_id: msg.message_id,
        chat_id: String(msg.chat?.id ?? archiveChatId),
      };
    }
    throw new Error('Telegram javobida file_id topilmadi');
  }

  async function uploadToArchive({ buffer, filename, mimeType, caption = '' }) {
    if (!hasArchive()) throw new Error('BOT_TOKEN yoki ARCHIVE_CHAT_ID sozlanmagan');
    const form = new FormData();
    form.set('chat_id', archiveChatId);
    if (caption) form.set('caption', String(caption).slice(0, 1024));
    form.set('document', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename || 'fayl');
    const msg = await callApi('sendDocument', { form });
    return extractTelegramFileMeta(msg, filename, mimeType, buffer.length);
  }

  async function downloadFileBytes(fileId) {
    if (!botToken) throw new Error('BOT_TOKEN sozlanmagan');
    const info = await callApi('getFile', { json: { file_id: fileId } });
    if (!info?.file_path) throw new Error('Telegram getFile file_path qaytarmadi');
    const fileUrl = `${TG_API}/file/bot${botToken}/${info.file_path}`;
    const res = await fetchImpl(fileUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Telegram fayl yuklab olish xatosi: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function sendMessage({ chatId, text, replyMarkup = null }) {
    if (!botToken || !chatId) return null;
    const json = { chat_id: String(chatId), text: String(text || '').slice(0, 4096) };
    if (replyMarkup) json.reply_markup = replyMarkup;
    return callApi('sendMessage', { json });
  }

  async function sendDocument({ chatId, fileId = null, buffer = null, filename = 'hujjat', mimeType = 'application/octet-stream', caption = '' }) {
    if (!botToken || !chatId) return null;
    if (fileId) {
      return callApi('sendDocument', {
        json: {
          chat_id: String(chatId),
          document: fileId,
          ...(caption ? { caption: String(caption).slice(0, 1024) } : {}),
        },
      });
    }
    if (!buffer) return null;
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (caption) form.set('caption', String(caption).slice(0, 1024));
    form.set('document', new Blob([buffer], { type: mimeType }), filename);
    return callApi('sendDocument', { form });
  }

  function launchKeyboard() {
    if (!appUrl) return null;
    const btn = /^https:\/\//i.test(appUrl)
      ? { text: '🚀 Tizimga kirish', web_app: { url: appUrl } }
      : { text: '🚀 Tizimga kirish', url: appUrl };
    return { inline_keyboard: [[btn]] };
  }

  async function handleUpdate(update, { repo, verifyPassword, nowIso = () => new Date().toISOString() }) {
    const msg = update?.message || update?.edited_message;
    if (!msg?.chat?.id) return { ok: true, ignored: true };
    const chatId = String(msg.chat.id);
    const username = msg.from?.username || msg.chat?.username || null;
    const firstName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.chat?.first_name || null;
    const text = String(msg.text || '').trim();

    let linkedUser = await repo.userByTelegramChatId(chatId);
    await repo.upsertTelegramVisitor({
      chat_id: chatId,
      username,
      first_name: firstName,
      user_id: linkedUser?.id ?? null,
      updated_at: nowIso(),
    });

    if (text.startsWith('/start')) {
      const arg = text.split(/\s+/)[1] || '';
      let extra = '';
      if (arg.startsWith('link_')) {
        const uid = verifyLinkToken(arg.slice(5));
        const u = uid ? await repo.userById(uid) : null;
        if (u && u.active) {
          if (u.code === 'U001') {
            extra = '\n\nℹ️ Avval veb-ilovada oʻzingizning shaxsiy login va profilingizni yarating, soʻngra Telegram botni ulang.';
          } else {
            await repo.setTelegramChat(u.id, chatId, username);
            await repo.upsertTelegramVisitor({ chat_id: chatId, username, first_name: firstName, user_id: u.id, updated_at: nowIso() });
            linkedUser = u;
            extra = `\n\n✅ Telegram hisobingiz "${u.name}" profiliga muvaffaqiyatli bogʻlandi! Endi barcha topshiriq va nazorat varaqalari shu yerga keladi.`;
          }
        } else {
          extra = '\n\n⚠️ Bogʻlash havolasi eskirgan yoki yaroqsiz. Tizimdan yangi havola oling yoki /ulash <login> <parol> buyrugʻini yuboring.';
        }
      } else if (linkedUser) {
        extra = `\n\n✅ Siz "${linkedUser.name}" profiliga ulangansiz.`;
      } else {
        extra = '\n\n🔗 Profilingizni Telegramga ulash uchun tizim ichidagi "Telegramni ulash" tugmasini bosing yoki quyidagini yuboring:\n/ulash <shaxsiy_login> <parol>';
      }

      const guide = [
        `Assalomu alaykum${firstName ? ', ' + firstName : ''}! 👋`,
        '«Hujjatlar aylanishi va ijro nazorati» tizimining rasmiy Telegram botiga xush kelibsiz.',
        '',
        '📌 Qisqa yoʻllanma:',
        '1. Pastdagi "🚀 Tizimga kirish" tugmasi orqali platformani oching.',
        '2. Yangi xodim boʻlsangiz, birinchi marta U001 / 12345678 orqali kirib shaxsiy profilingizni yarating.',
        '3. Sizga biriktirilgan nazorat varaqalari va hujjat fayllari avtomatik tarzda shu chatga yuboriladi.' + extra,
      ].join('\n');

      await sendMessage({ chatId, text: guide, replyMarkup: launchKeyboard() }).catch((e) => {
        logger?.warn?.('telegram_start_reply_failed', { chatId, error: e?.message });
      });
      return { ok: true, command: 'start', linked: Boolean(linkedUser) };
    }

    if (text.startsWith('/ulash')) {
      const parts = text.split(/\s+/);
      const login = parts[1];
      const password = parts.slice(2).join(' ');
      if (!login || !password) {
        await sendMessage({
          chatId,
          text: 'Foydalanish: /ulash <login> <parol>\nMasalan: /ulash r_karimov meningparolim',
        }).catch(() => {});
        return { ok: true, command: 'ulash', status: 'syntax' };
      }
      const user = await repo.userByCodeIgnoreCase(login.trim());
      if (!user || !user.active || !user.password_hash || !verifyPassword(password, user.password_hash)) {
        await sendMessage({ chatId, text: '❌ Login yoki parol notoʻgʻri.' }).catch(() => {});
        return { ok: true, command: 'ulash', status: 'invalid' };
      }
      if (user.code === 'U001') {
        await sendMessage({
          chatId,
          text: 'ℹ️ U001 — umumiy shablon akkaunt. Avval veb-ilovada shaxsiy profilingizni yarating, soʻngra shaxsiy loginingiz bilan ulang.',
          replyMarkup: launchKeyboard(),
        }).catch(() => {});
        return { ok: true, command: 'ulash', status: 'template_blocked' };
      }
      await repo.setTelegramChat(user.id, chatId, username);
      await repo.upsertTelegramVisitor({ chat_id: chatId, username, first_name: firstName, user_id: user.id, updated_at: nowIso() });
      await sendMessage({
        chatId,
        text: `✅ Tabriklaymiz! Telegram bot "${user.name}" (${user.code}) profiliga muvaffaqiyatli bogʻlandi.\nXavfsizlik uchun yuqoridagi parol yozilgan xabarni oʻchirib tashlashingiz mumkin.`,
        replyMarkup: launchKeyboard(),
      }).catch(() => {});
      return { ok: true, command: 'ulash', linked: true, user_id: user.id };
    }

    // Boshqa har qanday xabarga holat va kirish tugmasi
    const info = linkedUser
      ? `✅ Profilingiz ulangan: ${linkedUser.name}.\nPlatformaga kirish uchun quyidagi tugmani bosing:`
      : 'ℹ️ Hozircha shaxsiy profil ulanmagan.\n/start yoki /ulash <login> <parol> yuboring, yoki tizimga kiring:';
    await sendMessage({ chatId, text: info, replyMarkup: launchKeyboard() }).catch(() => {});
    return { ok: true };
  }

  return {
    hasBot,
    hasArchive,
    getMe,
    setWebhook,
    createLinkToken,
    verifyLinkToken,
    verifyWebAppInitData,
    uploadToArchive,
    downloadFileBytes,
    sendMessage,
    sendDocument,
    handleUpdate,
  };
}
