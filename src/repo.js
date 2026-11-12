// Ma'lumotlar qatlami (repository): faqat SQL. Biznes qoidalari service.js da.
const plain = (r) => (r ? { ...r } : null);
const plainAll = (rows) => rows.map((r) => ({ ...r }));
const ph = (a) => a.map(() => '?').join(',');
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const VISIBLE_TO_USER = `(d.created_by = ? OR
  EXISTS (SELECT 1 FROM signatures s WHERE s.doc_id = d.id AND s.user_id = ?) OR
  EXISTS (SELECT 1 FROM tasks t JOIN assignees a ON a.task_id = t.id WHERE t.doc_id = d.id AND a.user_id = ?))`;

export function createRepo(db) {
  const inChunks = async (ids, fn) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...(await fn(ids.slice(i, i + 500))));
    return out;
  };
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return m;
  };

  async function hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const tasks = await inChunks(ids, (c) => db.all(`SELECT * FROM tasks WHERE doc_id IN (${ph(c)}) ORDER BY id`, ...c));
    const assignees = await inChunks(tasks.map((t) => t.id), (c) => db.all(`SELECT * FROM assignees WHERE task_id IN (${ph(c)}) ORDER BY id`, ...c));
    const sigs = await inChunks(ids, (c) => db.all(`SELECT * FROM signatures WHERE doc_id IN (${ph(c)}) ORDER BY ord, id`, ...c));
    const trs = await inChunks(ids, (c) => db.all(`SELECT * FROM transfers WHERE doc_id IN (${ph(c)}) ORDER BY id`, ...c));
    const atts = await inChunks(ids, (c) => db.all(
      `SELECT id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, tg_file_id, created_at FROM attachments WHERE doc_id IN (${ph(c)}) ORDER BY id`,
      ...c,
    ));

    const aByTask = group(assignees, 'task_id');
    const tByDoc = group(tasks, 'doc_id');
    const sByDoc = group(sigs, 'doc_id');
    const rByDoc = group(trs, 'doc_id');
    const attByDoc = group(atts.filter((f) => f.kind === 'document'), 'doc_id');
    const attByAssignee = group(atts.filter((f) => f.kind === 'response' && f.assignee_id != null), 'assignee_id');

    return rows.map((r) => ({
      id: r.id, number: r.number, type: r.type, title: r.title, org_id: r.org_id,
      department: r.department ?? null, priority: r.priority || 'normal',
      created_by: r.created_by, created_at: r.created_at,
      attachments: (attByDoc.get(r.id) || []).map(({ id, orig_name, mime_type, size_bytes, uploaded_by, note, tg_file_id, created_at }) => ({
        id, orig_name, mime_type, size_bytes, uploaded_by, note: note ?? null, archived_tg: Boolean(tg_file_id), created_at,
      })),
      tasks: (tByDoc.get(r.id) || []).map((t) => ({
        id: t.id, doc_id: t.doc_id, title: t.title, issued_by: t.issued_by, deadline: t.deadline,
        assignees: (aByTask.get(t.id) || []).map(({
          id, user_id, assigned_by, assigned_at, done_date, done_at, completion_note,
          viewed_at, delegated_to, delegated_at, delegation_note,
        }) => ({
          id, user_id, assigned_by, assigned_at, done_date,
          done_at: done_at ?? null,
          completion_note: completion_note ?? null,
          viewed_at: viewed_at ?? null,
          delegated_to: delegated_to ?? null,
          delegated_at: delegated_at ?? null,
          delegation_note: delegation_note ?? null,
          files: (attByAssignee.get(id) || []).map(({ id: fid, orig_name, mime_type, size_bytes, uploaded_by, note, tg_file_id, created_at }) => ({
            id: fid, orig_name, mime_type, size_bytes, uploaded_by, note: note ?? null, archived_tg: Boolean(tg_file_id), created_at,
          })),
        })),
      })),
      signatures: (sByDoc.get(r.id) || []).map(({ id, user_id, ord, signed_at }) => ({ id, user_id, ord, signed_at })),
      transfers: (rByDoc.get(r.id) || []).map(({ id, from_org, to_org, sent_at, received_at }) => ({ id, from_org, to_org, sent_at, received_at })),
    }));
  }

  return {
    // ---- foydalanuvchilar / tashkilotlar ----
    userByCode: async (code) => plain(await db.get('SELECT * FROM users WHERE code = ?', code)),
    userByCodeIgnoreCase: async (code) => plain(await db.get('SELECT * FROM users WHERE LOWER(code) = LOWER(?)', code)),
    userById: async (id) => plain(await db.get('SELECT * FROM users WHERE id = ?', id)),
    userByTelegramChatId: async (chatId) => plain(await db.get('SELECT * FROM users WHERE telegram_chat_id = ?', String(chatId))),
    listUsers: async () => plainAll(await db.all(
      'SELECT id, name, org_id, department, pos, role, code, active, must_change_password, telegram_chat_id, telegram_username, created_at FROM users ORDER BY id',
    )),
    countUsers: async () => Number((await db.get('SELECT COUNT(*) n FROM users'))?.n ?? 0),
    insertUser: async (u) => {
      const r = await db.run(
        'INSERT INTO users (name, org_id, department, pos, role, code, password_hash, must_change_password, telegram_chat_id, telegram_username, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        u.name, u.org_id, u.department ?? null, u.pos ?? null, u.role, u.code,
        u.password_hash ?? null, u.must_change_password ? 1 : 0,
        u.telegram_chat_id ?? null, u.telegram_username ?? null,
        u.created_at ?? new Date().toISOString(),
      );
      return Number(r.lastInsertRowid);
    },
    setPassword: async (id, hash, mustChange = 0) =>
      (await db.run('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', hash, mustChange ? 1 : 0, id)).changes,
    setRole: async (id, role) =>
      (await db.run('UPDATE users SET role = ? WHERE id = ?', role, id)).changes,
    setActive: async (id, active) =>
      (await db.run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id)).changes,
    setTelegramChat: async (userId, chatId, username = null) => {
      const cleanChat = chatId != null && String(chatId).trim() ? String(chatId).trim() : null;
      if (cleanChat) {
        await db.run('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE telegram_chat_id = ? AND id != ?', cleanChat, userId);
      }
      return (await db.run(
        'UPDATE users SET telegram_chat_id = ?, telegram_username = COALESCE(?, telegram_username) WHERE id = ?',
        cleanChat, username ?? null, userId,
      )).changes;
    },
    upsertTelegramVisitor: async ({ chat_id, username = null, first_name = null, user_id = null, updated_at }) =>
      (await db.run(
        `INSERT INTO telegram_chats (chat_id, username, first_name, user_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           username = COALESCE(excluded.username, telegram_chats.username),
           first_name = COALESCE(excluded.first_name, telegram_chats.first_name),
           user_id = COALESCE(excluded.user_id, telegram_chats.user_id),
           updated_at = excluded.updated_at`,
        String(chat_id), username, first_name, user_id, updated_at,
      )).changes,
    listTelegramVisitors: async (limit = 50) => plainAll(await db.all('SELECT * FROM telegram_chats ORDER BY updated_at DESC LIMIT ?', limit)),
    updateUser: async (id, f) => {
      const keys = Object.keys(f);
      if (!keys.length) return 0;
      return (await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(f), id)).changes;
    },
    deleteUser: async (id, fallbackId) => {
      await db.run('UPDATE documents SET created_by = ? WHERE created_by = ?', fallbackId, id);
      await db.run('UPDATE tasks SET issued_by = ? WHERE issued_by = ?', fallbackId, id);
      await db.run('UPDATE attachments SET uploaded_by = ? WHERE uploaded_by = ?', fallbackId, id);
      await db.run('UPDATE assignees SET assigned_by = ? WHERE assigned_by = ?', fallbackId, id);
      await db.run('UPDATE assignees SET delegated_to = NULL WHERE delegated_to = ?', id);
      await db.run('DELETE FROM assignees WHERE user_id = ?', id);
      await db.run('DELETE FROM signatures WHERE user_id = ?', id);
      await db.run('DELETE FROM notifications WHERE user_id = ?', id);
      await db.run('UPDATE doc_events SET user_id = NULL WHERE user_id = ?', id);
      await db.run('UPDATE integration_settings SET updated_by = NULL WHERE updated_by = ?', id);
      await db.run('UPDATE telegram_chats SET user_id = NULL WHERE user_id = ?', id);
      return (await db.run('DELETE FROM users WHERE id = ?', id)).changes;
    },
    listOrgs: async () => plainAll(await db.all('SELECT id, name FROM organizations ORDER BY id')),
    orgById: async (id) => plain(await db.get('SELECT id, name FROM organizations WHERE id = ?', id)),
    orgByName: async (name) => plain(await db.get('SELECT id, name FROM organizations WHERE LOWER(name) = LOWER(?)', name)),
    insertOrg: async (name) => Number((await db.run('INSERT INTO organizations (name) VALUES (?)', name)).lastInsertRowid),
    countOrgs: async () => Number((await db.get('SELECT COUNT(*) n FROM organizations'))?.n ?? 0),
    countDocs: async () => Number((await db.get('SELECT COUNT(*) n FROM documents'))?.n ?? 0),

    // ---- hujjatlar ----
    findDocs: async ({ user = null, q, org_id, date_from, date_to } = {}) => {
      const where = [];
      const params = [];
      if (user) { where.push(VISIBLE_TO_USER); params.push(user.id, user.id, user.id); }
      if (q) {
        const like = `%${escapeLike(q)}%`;
        where.push("(d.number LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\' OR d.type LIKE ? ESCAPE '\\' OR COALESCE(d.department, '') LIKE ? ESCAPE '\\')");
        params.push(like, like, like, like);
      }
      if (org_id) { where.push('d.org_id = ?'); params.push(org_id); }
      if (date_from) { where.push('d.created_at >= ?'); params.push(date_from); }
      if (date_to) { where.push('d.created_at <= ?'); params.push(date_to); }
      const sql = `SELECT d.* FROM documents d ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.created_at DESC, d.id DESC`;
      return hydrate(await db.all(sql, ...params));
    },
    docById: async (id) => {
      const row = await db.get('SELECT * FROM documents WHERE id = ?', id);
      return row ? (await hydrate([row]))[0] : null;
    },
    docByNumber: async (number) => plain(await db.get('SELECT id FROM documents WHERE number = ?', number)),
    insertDoc: async (d) => Number((await db.run(
      'INSERT INTO documents (number, type, title, org_id, department, priority, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
      d.number, d.type, d.title, d.org_id, d.department ?? null, d.priority || 'normal', d.created_by, d.created_at,
    )).lastInsertRowid),
    updateDoc: async (id, f) => {
      const keys = Object.keys(f);
      if (!keys.length) return 0;
      return (await db.run(`UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(f), id)).changes;
    },
    deleteDoc: async (id) => (await db.run('DELETE FROM documents WHERE id = ?', id)).changes,

    insertTask: async (t) => Number((await db.run(
      'INSERT INTO tasks (doc_id, title, issued_by, deadline) VALUES (?,?,?,?)',
      t.doc_id, t.title, t.issued_by, t.deadline,
    )).lastInsertRowid),
    taskById: async (id) => plain(await db.get(
      'SELECT t.*, d.number AS doc_number, d.title AS doc_title, d.type AS doc_type, d.created_by AS doc_created_by FROM tasks t JOIN documents d ON d.id = t.doc_id WHERE t.id = ?',
      id,
    )),
    deleteTask: async (id) => (await db.run('DELETE FROM tasks WHERE id = ?', id)).changes,
    insertAssignee: async (a) => Number((await db.run(
      'INSERT INTO assignees (task_id, user_id, assigned_by, assigned_at, done_date) VALUES (?,?,?,?,?)',
      a.task_id, a.user_id, a.assigned_by, a.assigned_at, a.done_date ?? null,
    )).lastInsertRowid),
    assigneeExists: async (task_id, user_id) => !!(await db.get('SELECT 1 FROM assignees WHERE task_id = ? AND user_id = ?', task_id, user_id)),
    assigneeById: async (id) => plain(await db.get(
      `SELECT a.*, t.deadline, t.doc_id, t.title AS task_title, t.issued_by,
              d.created_at AS doc_created_at, d.number AS doc_number, d.title AS doc_title, d.created_by AS doc_created_by
       FROM assignees a JOIN tasks t ON t.id = a.task_id JOIN documents d ON d.id = t.doc_id WHERE a.id = ?`,
      id,
    )),
    deleteAssignee: async (id) => (await db.run('DELETE FROM assignees WHERE id = ?', id)).changes,
    clearDelegationTarget: async (task_id, user_id) =>
      (await db.run('UPDATE assignees SET delegated_to = NULL, delegated_at = NULL, delegation_note = NULL WHERE task_id = ? AND delegated_to = ?', task_id, user_id)).changes,
    setDone: async (id, done_date, completion_note = undefined, done_at = undefined) => {
      if (done_date === null) {
        return (await db.run('UPDATE assignees SET done_date = NULL, done_at = NULL WHERE id = ?', id)).changes;
      }
      if (completion_note !== undefined) {
        return (await db.run(
          'UPDATE assignees SET done_date = ?, completion_note = ?, done_at = COALESCE(?, done_at) WHERE id = ?',
          done_date, completion_note, done_at ?? null, id,
        )).changes;
      }
      return (await db.run(
        'UPDATE assignees SET done_date = ?, done_at = COALESCE(?, done_at) WHERE id = ?',
        done_date, done_at ?? null, id,
      )).changes;
    },

    insertSignature: async (s) => Number((await db.run(
      'INSERT INTO signatures (doc_id, user_id, ord, signed_at) VALUES (?,?,?,?)',
      s.doc_id, s.user_id, s.ord, s.signed_at ?? null,
    )).lastInsertRowid),
    pendingSignature: async (doc_id, user_id) => plain(await db.get('SELECT * FROM signatures WHERE doc_id = ? AND user_id = ? AND signed_at IS NULL', doc_id, user_id)),
    sign: async (id, date) => (await db.run('UPDATE signatures SET signed_at = ? WHERE id = ?', date, id)).changes,

    insertTransfer: async (t) => Number((await db.run(
      'INSERT INTO transfers (doc_id, from_org, to_org, sent_at, received_at) VALUES (?,?,?,?,?)',
      t.doc_id, t.from_org, t.to_org, t.sent_at, t.received_at ?? null,
    )).lastInsertRowid),

    // ---- fayl biriktirmalari (attachments) ----
    insertAttachment: async (a) => Number((await db.run(
      `INSERT INTO attachments (doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, data, tg_file_id, tg_message_id, tg_chat_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      a.doc_id, a.assignee_id ?? null, a.uploaded_by, a.kind || 'document',
      a.orig_name, a.mime_type, a.size_bytes, a.note ?? null,
      a.data ?? null, a.tg_file_id ?? null, a.tg_message_id ?? null, a.tg_chat_id ?? null, a.created_at,
    )).lastInsertRowid),
    attachmentById: async (id) => plain(await db.get(
      'SELECT id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, tg_file_id, tg_message_id, tg_chat_id, created_at FROM attachments WHERE id = ?',
      id,
    )),
    attachmentBlobById: async (id) => plain(await db.get('SELECT * FROM attachments WHERE id = ?', id)),
    attachmentsByDoc: async (docId, kind = 'document') => plainAll(await db.all(
      'SELECT id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, data, tg_file_id, tg_message_id, tg_chat_id, created_at FROM attachments WHERE doc_id = ? AND kind = ? ORDER BY id',
      docId, kind,
    )),
    deleteAttachment: async (id) => (await db.run('DELETE FROM attachments WHERE id = ?', id)).changes,

    // ---- arxiv (hujjatlar + javob fayllari + iqtiboslar) ----
    listArchive: async ({ user = null } = {}) => {
      const where = user ? `WHERE ${VISIBLE_TO_USER}` : '';
      const params = user ? [user.id, user.id, user.id] : [];
      return plainAll(await db.all(
        `SELECT att.id AS attachment_id, att.doc_id, att.assignee_id, att.uploaded_by, att.kind,
                att.orig_name, att.mime_type, att.size_bytes, att.note, att.tg_file_id, att.created_at AS uploaded_at,
                d.number AS doc_number, d.type AS doc_type, d.title AS doc_title, d.org_id, d.department, d.created_at AS doc_created_at,
                u.name AS uploader_name, o.name AS org_name,
                a.done_date, a.done_at, a.completion_note, t.deadline
         FROM attachments att
         JOIN documents d ON d.id = att.doc_id
         LEFT JOIN organizations o ON o.id = d.org_id
         LEFT JOIN users u ON u.id = att.uploaded_by
         LEFT JOIN assignees a ON a.id = att.assignee_id
         LEFT JOIN tasks t ON t.id = a.task_id
         ${where}
         ORDER BY att.id DESC`,
        ...params,
      ));
    },

    // ---- SMS navbati / audit ----
    enqueueSms: async (s) => db.run('INSERT INTO sms_queue (to_name, text, at, status) VALUES (?,?,?,?)', s.to, s.text, s.at, s.status || 'navbatda'),
    enqueueSmsPhone: async (s) => db.run('INSERT INTO sms_queue (to_name, to_phone, text, at, status) VALUES (?,?,?,?,?)', s.to, s.phone ?? null, s.text, s.at, s.status || 'navbatda'),
    listSms: async () => plainAll(await db.all('SELECT to_name AS "to", text, at, status FROM sms_queue ORDER BY id')),
    updateSmsStatus: async (id, status, error) => db.run('UPDATE sms_queue SET status = ?, error = ? WHERE id = ?', status, error ?? null, id),
    pendingSms: async (limit = 50) => plainAll(await db.all("SELECT * FROM sms_queue WHERE status = 'navbatda' ORDER BY id LIMIT ?", limit)),
    insertAudit: async (e) => db.run(
      'INSERT INTO audit_log (at, user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)',
      e.at, e.user_id ?? null, e.action, e.entity ?? null, e.entity_id ?? null, e.details ? JSON.stringify(e.details) : null, e.ip ?? null,
    ),
    listAudit: async ({ limit, offset }) => {
      const total = Number((await db.get('SELECT COUNT(*) n FROM audit_log'))?.n ?? 0);
      const rows = plainAll(await db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset))
        .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
      return { rows, total };
    },

    // ---- ko'rish vaqtini qayd etish ----
    setViewed: async (assigneeId, userId, viewedAt) =>
      (await db.run('UPDATE assignees SET viewed_at = ? WHERE id = ? AND user_id = ? AND viewed_at IS NULL', viewedAt, assigneeId, userId)).changes,

    // ---- delegatsiya (uzatish) ----
    delegate: async (assigneeId, toUserId, note, at) =>
      (await db.run('UPDATE assignees SET delegated_to = ?, delegated_at = ?, delegation_note = ? WHERE id = ?', toUserId, at, note ?? null, assigneeId)).changes,

    // ---- doc_events (hayot sikli) ----
    insertEvent: async (e) => Number((await db.run(
      'INSERT INTO doc_events (doc_id, user_id, event_type, details, created_at) VALUES (?,?,?,?,?)',
      e.doc_id, e.user_id ?? null, e.event_type, e.details ? JSON.stringify(e.details) : null, e.created_at,
    )).lastInsertRowid),
    hasEvent: async (docId, userId, eventType) =>
      Boolean(await db.get('SELECT 1 FROM doc_events WHERE doc_id = ? AND user_id = ? AND event_type = ? LIMIT 1', docId, userId, eventType)),
    listEvents: async (docId) =>
      plainAll(await db.all('SELECT e.*, u.name as user_name FROM doc_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.doc_id = ? ORDER BY e.id', docId))
        .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),

    // ---- integratsiya sozlamalari ----
    getIntegration: async (key) => {
      const r = plain(await db.get('SELECT * FROM integration_settings WHERE key = ?', key));
      return r && r.value ? { ...r, value: JSON.parse(r.value) } : r;
    },
    listIntegrations: async () => plainAll(await db.all('SELECT * FROM integration_settings ORDER BY key'))
      .map((r) => ({ ...r, value: r.value ? JSON.parse(r.value) : null })),
    setIntegration: async (key, value, updatedBy, updatedAt) => db.run(
      'INSERT INTO integration_settings (key, value, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
      key, value ? JSON.stringify(value) : null, updatedAt, updatedBy,
    ),
    deleteIntegration: async (key) => (await db.run('DELETE FROM integration_settings WHERE key = ?', key)).changes,

    // ---- bildirishnomalar ----
    insertNotification: async (n) => Number((await db.run(
      'INSERT INTO notifications (user_id, doc_id, type, title, body, read, created_at) VALUES (?,?,?,?,?,0,?)',
      n.user_id ?? null, n.doc_id ?? null, n.type, n.title, n.body ?? null, n.created_at,
    )).lastInsertRowid),
    listNotifications: async (userId, limit = 30) =>
      plainAll(await db.all('SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY id DESC LIMIT ?', userId, limit)),
    countUnread: async (userId) =>
      Number((await db.get('SELECT COUNT(*) n FROM notifications WHERE (user_id IS NULL OR user_id = ?) AND read = 0', userId))?.n ?? 0),
    markRead: async (id, userId) =>
      (await db.run('UPDATE notifications SET read = 1 WHERE id = ? AND (user_id IS NULL OR user_id = ?)', id, userId)).changes,
    markAllRead: async (userId) =>
      (await db.run('UPDATE notifications SET read = 1 WHERE (user_id IS NULL OR user_id = ?) AND read = 0', userId)).changes,

    // ---- demo tozalash ----
    clearDemoData: async (keepUserId) => db.tx(async (tdb) => {
      await tdb.run('DELETE FROM notifications');
      await tdb.run('DELETE FROM sms_queue');
      await tdb.run('DELETE FROM audit_log');
      await tdb.run('DELETE FROM refresh_tokens WHERE user_id != ?', keepUserId);
      await tdb.run('DELETE FROM doc_events');
      await tdb.run('DELETE FROM documents');
      try {
        await tdb.exec("UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('documents','tasks','assignees','signatures','transfers','sms_queue','audit_log','notifications','doc_events','attachments')");
      } catch { /* Turso yoki sqlite_sequence bo'lmasa xato bermaydi */ }
    }),

    ping: async () => Number((await db.get('SELECT 1 AS ok'))?.ok ?? 0) === 1,
  };
}
