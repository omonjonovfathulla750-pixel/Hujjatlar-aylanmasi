import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openDb, tx } from '../../src/db.js';
import { createRepo } from '../../src/repo.js';
import { createTelegramService } from '../../src/telegram.js';
import { id, newDoc, setupRoles, startTestApp, testConfig } from '../helpers.js';

function createFakeLibsqlClient() {
  const sqlite = new DatabaseSync(':memory:');
  const runStmt = (stmt) => {
    const sql = typeof stmt === 'string' ? stmt : stmt.sql;
    const args = typeof stmt === 'string' ? [] : (stmt.args || []);
    const s = sqlite.prepare(sql);
    const trimmed = sql.trim().toUpperCase();
    const returnsRows = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH') || /\bRETURNING\b/i.test(sql);
    if (returnsRows) {
      const rows = s.all(...args);
      return { columns: [], rows, rowsAffected: 0, lastInsertRowid: undefined };
    }
    const info = s.run(...args);
    return {
      columns: [],
      rows: [],
      rowsAffected: Number(info.changes ?? 0),
      lastInsertRowid: info.lastInsertRowid !== undefined ? BigInt(info.lastInsertRowid) : undefined,
    };
  };
  return {
    sqlite,
    async execute(stmt) { return runStmt(stmt); },
    async executeMultiple(sql) { sqlite.exec(sql); },
    async transaction() {
      sqlite.exec('BEGIN');
      let ended = false;
      return {
        async execute(stmt) { return runStmt(stmt); },
        async commit() { if (!ended) { ended = true; sqlite.exec('COMMIT'); } },
        async rollback() { if (!ended) { ended = true; sqlite.exec('ROLLBACK'); } },
        close() {},
      };
    },
    close() { sqlite.close(); },
  };
}

test('Turso (@libsql/client) adapteri: migratsiya, CRUD, tx commit/rollback va eski sxema mosligi', async () => {
  const client = createFakeLibsqlClient();
  const db = await openDb(':memory:', { client });
  try {
    const repo = createRepo(db);
    const orgId = await repo.insertOrg('Turso Tashkilot');
    const uid = await repo.insertUser({ name: 'Turso Admin', org_id: orgId, role: 'admin', code: 'tadmin', telegram_chat_id: '777888' });
    const u = await repo.userById(uid);
    assert.equal(u.telegram_chat_id, '777888');

    const ok = await tx(db, async () => {
      await repo.insertOrg('Ichki Tx');
      return 123;
    });
    assert.equal(ok, 123);

    await assert.rejects(() => tx(db, async () => {
      await repo.insertOrg('Bekor Boladigan');
      throw new Error('rollback_test');
    }), /rollback_test/);

    assert.equal(await repo.countOrgs(), 2);
  } finally {
    await db.close();
  }
});

test('Telegram bulut arxivi, bot /start + ulash, topshiriq yuborish va arxiv UI/API oqimi', async () => {
  const calls = [];
  const storedBlobs = new Map();
  let seq = 0;

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.telegram.org/file/bot')) {
      const filePath = u.split('/file/bot123:test-token/')[1];
      const buf = storedBlobs.get(filePath) || Buffer.from('missing');
      return new Response(buf, { status: 200 });
    }
    const method = u.split('/').pop();
    let payload = {};
    if (init.body instanceof FormData) {
      for (const [k, v] of init.body.entries()) {
        if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') {
          const ab = Buffer.from(await v.arrayBuffer());
          payload[k] = { filename: v.name || 'file', type: v.type, bytes: ab };
        } else {
          payload[k] = v;
        }
      }
    } else if (typeof init.body === 'string') {
      payload = JSON.parse(init.body);
    }
    calls.push({ method, payload });

    if (method === 'getMe') return Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'hujjat_nazorat_bot' } });
    if (method === 'setWebhook') return Response.json({ ok: true, result: true });
    if (method === 'sendMessage') return Response.json({ ok: true, result: { message_id: ++seq } });
    if (method === 'sendDocument') {
      seq += 1;
      const fileId = typeof payload.document === 'string' ? payload.document : `tg_file_${seq}`;
      const filePath = `documents/file_${seq}.bin`;
      if (payload.document?.bytes) storedBlobs.set(filePath, payload.document.bytes);
      storedBlobs.set(`id:${fileId}`, filePath);
      return Response.json({ ok: true, result: { message_id: seq, document: { file_id: fileId } } });
    }
    if (method === 'getFile') {
      const fp = storedBlobs.get(`id:${payload.file_id}`) || 'documents/file_1.bin';
      return Response.json({ ok: true, result: { file_id: payload.file_id, file_path: fp } });
    }
    return Response.json({ ok: false, description: 'unknown method' }, { status: 400 });
  };

  const tgEnv = {
    BOT_TOKEN: '123:test-token',
    ARCHIVE_CHAT_ID: '-1004487202108',
    APP_URL: 'https://dashboard.onrender.com',
  };
  const tgSvc = createTelegramService({ config: testConfig(tgEnv), fetchImpl: mockFetch });
  const t = await startTestApp({ env: tgEnv, realClock: true, telegram: tgSvc });
  await setupRoles(t);

  try {
    const admin = await t.tokenFor('admin');
    const u4Tok = await t.tokenFor('U004');
    const adminUser = await t.repo.userByCode('admin');
    const u4User = await t.repo.userByCode('U004');

    // Webhook sozlash
    const wh = await tgSvc.setWebhook();
    assert.equal(wh.ok, true);
    assert.equal(wh.url, 'https://dashboard.onrender.com/api/v1/telegram/webhook');

    // Admin va xodim o'z Telegram chat_id sini /start link_ va /ulash orqali bog'laydi
    const linkInfo = await t.api('GET', '/auth/telegram-link', { token: u4Tok });
    assert.equal(linkInfo.status, 200);
    assert.match(linkInfo.body.deep_link, /t\.me\/hujjat_nazorat_bot\?start=link_/);
    const linkToken = linkInfo.body.deep_link.split('?start=')[1];

    const startRes = await t.api('POST', '/telegram/webhook', {
      body: {
        update_id: 1,
        message: { chat: { id: 9004 }, from: { id: 9004, first_name: 'Jasur', username: 'jasur_tg' }, text: `/start ${linkToken}` },
      },
    });
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.linked, true);
    assert.equal((await t.repo.userById(u4User.id)).telegram_chat_id, '9004');

    // /start javobida "🚀 Tizimga kirish" inline web_app tugmasi bor
    const welcomeMsg = calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === '9004');
    assert.match(welcomeMsg.payload.text, /Yoʻllanma|yoʻllanma/i);
    assert.equal(welcomeMsg.payload.reply_markup.inline_keyboard[0][0].text, '🚀 Tizimga kirish');
    assert.equal(welcomeMsg.payload.reply_markup.inline_keyboard[0][0].web_app.url, 'https://dashboard.onrender.com');

    // Admin /ulash buyrug'i bilan ulanadi
    const ulashRes = await t.api('POST', '/telegram/webhook', {
      body: {
        update_id: 2,
        message: { chat: { id: 9001 }, from: { id: 9001, first_name: 'Rahbar' }, text: '/ulash admin adminpass1' },
      },
    });
    assert.equal(ulashRes.status, 200);
    assert.equal(ulashRes.body.linked, true);
    assert.equal((await t.repo.userById(adminUser.id)).telegram_chat_id, '9001');

    // 1) Admin hujjat yaratadi va multipart/form-data (multer.memoryStorage) orqali PDF fayl yuklaydi
    const doc = (await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'TG-DOC-1', title: 'Nazorat qarori' }) })).body;
    const pdfBytes = Buffer.from('%PDF-1.4\nCloud Archive Document');
    const docForm = new FormData();
    docForm.set('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'qaror.pdf');
    docForm.set('note', 'Asosiy qaror');
    const upDocRes = await fetch(`${t.base}/api/v1/documents/${doc.id}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: docForm,
    });
    assert.equal(upDocRes.status, 201);
    const upDoc = await upDocRes.json();
    assert.ok(upDoc.tg_file_id);

    // Fayl ARCHIVE_CHAT_ID ga yuborilgan va DB da lokal BLOB saqlanmagan
    const archiveDocPush = calls.find((c) => c.method === 'sendDocument' && c.payload.chat_id === '-1004487202108');
    assert.ok(archiveDocPush);
    const dbAtt = await t.repo.attachmentById(upDoc.id);
    assert.equal(dbAtt.data, null);
    assert.equal(dbAtt.tg_file_id, upDoc.tg_file_id);

    // Yuklab olish endpointi Telegram bulutidan faylni stream qiladi
    const dlDoc = await fetch(`${t.base}/api/v1/attachments/${upDoc.id}/download`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(dlDoc.status, 200);
    assert.equal(Buffer.from(await dlDoc.arrayBuffer()).toString(), pdfBytes.toString());

    // 2) Topshiriq U004 ga biriktirilganda Telegram xabari + hujjat fayli yuboriladi
    const assignRes = await t.api('POST', `/tasks/${doc.tasks[0].id}/assignees`, { token: admin, body: { user_id: u4User.id } });
    assert.equal(assignRes.status, 201);
    const aid = assignRes.body.id;

    const u4Push = calls.find((c) => c.method === 'sendDocument' && c.payload.chat_id === '9004');
    assert.ok(u4Push);
    assert.equal(u4Push.payload.document, upDoc.tg_file_id);
    assert.match(u4Push.payload.caption, /Hurmatli Rahimov Jasur, sizga .*TG-DOC-1.* nazorat varaqasi biriktirildi\. Ijro muddati:/);

    // 3) Xodim javob yuborishda iqtibos bo'sh bo'lsa 422, to'ldirilsa Telegram arxiv + Arxiv bo'limi + rahbar xabari
    const emptyForm = new FormData();
    emptyForm.set('file', new Blob([Buffer.from('ijro')], { type: 'text/plain' }), 'ijro.txt');
    emptyForm.set('note', '   ');
    const badResp = await fetch(`${t.base}/api/v1/assignees/${aid}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u4Tok}` },
      body: emptyForm,
    });
    assert.equal(badResp.status, 422);

    const respBytes = Buffer.from('Ijro hisoboti toliq tayyor');
    const okForm = new FormData();
    okForm.set('file', new Blob([respBytes], { type: 'text/plain' }), 'ijro-hisobot.txt');
    okForm.set('note', 'Barcha topshiriqlar ijrosi bajarildi va ilova qilindi');
    const okResp = await fetch(`${t.base}/api/v1/assignees/${aid}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u4Tok}` },
      body: okForm,
    });
    assert.equal(okResp.status, 201);
    const respJson = await okResp.json();
    assert.ok(respJson.tg_file_id);

    // Rahbar (9001) Telegram botiga javob xabari va fayl borgan
    const mgrDoc = calls.find((c) => c.method === 'sendDocument' && c.payload.chat_id === '9001' && c.payload.document === respJson.tg_file_id);
    assert.ok(mgrDoc);
    assert.match(mgrDoc.payload.caption, /Barcha topshiriqlar ijrosi bajarildi va ilova qilindi/);

    // Arxiv bo'limi (GET /archive) iqtibos va fayl havolasini qaytaradi
    const archRes = await t.api('GET', '/archive', { token: admin });
    assert.equal(archRes.status, 200);
    assert.equal(archRes.body.data.length, 1);
    assert.equal(archRes.body.data[0].doc_number, 'TG-DOC-1');
    assert.equal(archRes.body.data[0].completion_note, 'Barcha topshiriqlar ijrosi bajarildi va ilova qilindi');
    assert.equal(archRes.body.data[0].files[0].tg_file_id, respJson.tg_file_id);
  } finally {
    await t.close();
  }
});
