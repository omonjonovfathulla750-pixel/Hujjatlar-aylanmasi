// Ma'lumotlar qatlami (repository): faqat SQL. Biznes qoidalari service.js da.
const plain = (r) => (r ? { ...r } : null);
const plainAll = (rows) => rows.map((r) => ({ ...r }));
const ph = (a) => a.map(() => '?').join(',');
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const VISIBLE_TO_USER = `(d.created_by = ? OR
  EXISTS (SELECT 1 FROM signatures s WHERE s.doc_id = d.id AND s.user_id = ?) OR
  EXISTS (SELECT 1 FROM tasks t JOIN assignees a ON a.task_id = t.id WHERE t.doc_id = d.id AND a.user_id = ?))`;

export function createRepo(db) {
  const inChunks = (ids, fn) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...fn(ids.slice(i, i + 500)));
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

  function hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const tasks = inChunks(ids, (c) => plainAll(db.prepare(`SELECT * FROM tasks WHERE doc_id IN (${ph(c)}) ORDER BY id`).all(...c)));
    const assignees = inChunks(tasks.map((t) => t.id), (c) => plainAll(db.prepare(`SELECT * FROM assignees WHERE task_id IN (${ph(c)}) ORDER BY id`).all(...c)));
    const sigs = inChunks(ids, (c) => plainAll(db.prepare(`SELECT * FROM signatures WHERE doc_id IN (${ph(c)}) ORDER BY ord, id`).all(...c)));
    const trs = inChunks(ids, (c) => plainAll(db.prepare(`SELECT * FROM transfers WHERE doc_id IN (${ph(c)}) ORDER BY id`).all(...c)));
    const atts = inChunks(ids, (c) => plainAll(db.prepare(
      `SELECT id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, created_at FROM attachments WHERE doc_id IN (${ph(c)}) ORDER BY id`
    ).all(...c)));

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
      attachments: (attByDoc.get(r.id) || []).map(({ id, orig_name, mime_type, size_bytes, uploaded_by, note, created_at }) => ({
        id, orig_name, mime_type, size_bytes, uploaded_by, note: note ?? null, created_at,
      })),
      tasks: (tByDoc.get(r.id) || []).map((t) => ({
        id: t.id, doc_id: t.doc_id, title: t.title, issued_by: t.issued_by, deadline: t.deadline,
        assignees: (aByTask.get(t.id) || []).map(({ id, user_id, assigned_by, assigned_at, done_date, viewed_at, delegated_to, delegated_at, delegation_note }) => ({
          id, user_id, assigned_by, assigned_at, done_date,
          viewed_at: viewed_at ?? null,
          delegated_to: delegated_to ?? null,
          delegated_at: delegated_at ?? null,
          delegation_note: delegation_note ?? null,
          files: (attByAssignee.get(id) || []).map(({ id: fid, orig_name, mime_type, size_bytes, uploaded_by, note, created_at }) => ({
            id: fid, orig_name, mime_type, size_bytes, uploaded_by, note: note ?? null, created_at,
          })),
        })),
      })),
      signatures: (sByDoc.get(r.id) || []).map(({ id, user_id, ord, signed_at }) => ({ id, user_id, ord, signed_at })),
      transfers: (rByDoc.get(r.id) || []).map(({ id, from_org, to_org, sent_at, received_at }) => ({ id, from_org, to_org, sent_at, received_at })),
    }));
  }

  return {
    // ---- foydalanuvchilar / tashkilotlar ----
    userByCode: (code) => plain(db.prepare('SELECT * FROM users WHERE code = ?').get(code)),
    userById: (id) => plain(db.prepare('SELECT * FROM users WHERE id = ?').get(id)),
    listUsers: () => plainAll(db.prepare('SELECT id, name, org_id, department, pos, role, code, active, must_change_password FROM users ORDER BY id').all()),
    countUsers: () => db.prepare('SELECT COUNT(*) n FROM users').get().n,
    insertUser: (u) => Number(db.prepare('INSERT INTO users (name, org_id, department, pos, role, code, password_hash, must_change_password) VALUES (?,?,?,?,?,?,?,?)')
      .run(u.name, u.org_id, u.department ?? null, u.pos ?? null, u.role, u.code, u.password_hash ?? null, u.must_change_password ? 1 : 0).lastInsertRowid),
    setPassword: (id, hash, mustChange = 0) => db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(hash, mustChange ? 1 : 0, id).changes,
    setRole: (id, role) => db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id).changes,
    setActive: (id, active) => db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id).changes,
    updateUser(id, f) {
      const keys = Object.keys(f);
      if (!keys.length) return 0;
      return db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), id).changes;
    },
    deleteUser(id, fallbackId) {
      db.prepare('UPDATE documents SET created_by = ? WHERE created_by = ?').run(fallbackId, id);
      db.prepare('UPDATE tasks SET issued_by = ? WHERE issued_by = ?').run(fallbackId, id);
      db.prepare('UPDATE attachments SET uploaded_by = ? WHERE uploaded_by = ?').run(fallbackId, id);
      db.prepare('UPDATE assignees SET assigned_by = ? WHERE assigned_by = ?').run(fallbackId, id);
      db.prepare('UPDATE assignees SET delegated_to = NULL WHERE delegated_to = ?').run(id);
      db.prepare('DELETE FROM assignees WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM signatures WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
      db.prepare('UPDATE doc_events SET user_id = NULL WHERE user_id = ?').run(id);
      db.prepare('UPDATE integration_settings SET updated_by = NULL WHERE updated_by = ?').run(id);
      return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes;
    },
    listOrgs: () => plainAll(db.prepare('SELECT id, name FROM organizations ORDER BY id').all()),
    orgById: (id) => plain(db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(id)),
    orgByName: (name) => plain(db.prepare('SELECT id, name FROM organizations WHERE LOWER(name) = LOWER(?)').get(name)),
    insertOrg: (name) => Number(db.prepare('INSERT INTO organizations (name) VALUES (?)').run(name).lastInsertRowid),
    countOrgs: () => db.prepare('SELECT COUNT(*) n FROM organizations').get().n,
    countDocs: () => db.prepare('SELECT COUNT(*) n FROM documents').get().n,

    // ---- hujjatlar ----
    findDocs({ user = null, q, org_id, date_from, date_to } = {}) {
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
      return hydrate(db.prepare(sql).all(...params));
    },
    docById(id) {
      const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      return row ? hydrate([row])[0] : null;
    },
    docByNumber: (number) => plain(db.prepare('SELECT id FROM documents WHERE number = ?').get(number)),
    insertDoc: (d) => Number(db.prepare('INSERT INTO documents (number, type, title, org_id, department, priority, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(d.number, d.type, d.title, d.org_id, d.department ?? null, d.priority || 'normal', d.created_by, d.created_at).lastInsertRowid),
    updateDoc(id, f) {
      const keys = Object.keys(f);
      if (!keys.length) return 0;
      return db.prepare(`UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), id).changes;
    },
    deleteDoc: (id) => db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes,

    insertTask: (t) => Number(db.prepare('INSERT INTO tasks (doc_id, title, issued_by, deadline) VALUES (?,?,?,?)')
      .run(t.doc_id, t.title, t.issued_by, t.deadline).lastInsertRowid),
    taskById: (id) => plain(db.prepare('SELECT t.*, d.number AS doc_number FROM tasks t JOIN documents d ON d.id = t.doc_id WHERE t.id = ?').get(id)),
    deleteTask: (id) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes,
    insertAssignee: (a) => Number(db.prepare('INSERT INTO assignees (task_id, user_id, assigned_by, assigned_at, done_date) VALUES (?,?,?,?,?)')
      .run(a.task_id, a.user_id, a.assigned_by, a.assigned_at, a.done_date ?? null).lastInsertRowid),
    assigneeExists: (task_id, user_id) => !!db.prepare('SELECT 1 FROM assignees WHERE task_id = ? AND user_id = ?').get(task_id, user_id),
    assigneeById: (id) => plain(db.prepare(`SELECT a.*, t.deadline, t.doc_id, d.created_at AS doc_created_at, d.number AS doc_number, t.issued_by
      FROM assignees a JOIN tasks t ON t.id = a.task_id JOIN documents d ON d.id = t.doc_id WHERE a.id = ?`).get(id)),
    deleteAssignee: (id) => db.prepare('DELETE FROM assignees WHERE id = ?').run(id).changes,
    clearDelegationTarget: (task_id, user_id) =>
      db.prepare('UPDATE assignees SET delegated_to = NULL, delegated_at = NULL, delegation_note = NULL WHERE task_id = ? AND delegated_to = ?').run(task_id, user_id).changes,
    setDone: (id, done_date) => db.prepare('UPDATE assignees SET done_date = ? WHERE id = ?').run(done_date, id).changes,

    insertSignature: (s) => Number(db.prepare('INSERT INTO signatures (doc_id, user_id, ord, signed_at) VALUES (?,?,?,?)')
      .run(s.doc_id, s.user_id, s.ord, s.signed_at ?? null).lastInsertRowid),
    pendingSignature: (doc_id, user_id) => plain(db.prepare('SELECT * FROM signatures WHERE doc_id = ? AND user_id = ? AND signed_at IS NULL').get(doc_id, user_id)),
    sign: (id, date) => db.prepare('UPDATE signatures SET signed_at = ? WHERE id = ?').run(date, id).changes,

    insertTransfer: (t) => Number(db.prepare('INSERT INTO transfers (doc_id, from_org, to_org, sent_at, received_at) VALUES (?,?,?,?,?)')
      .run(t.doc_id, t.from_org, t.to_org, t.sent_at, t.received_at ?? null).lastInsertRowid),

    // ---- fayl biriktirmalari (attachments) ----
    insertAttachment: (a) => Number(db.prepare(
      'INSERT INTO attachments (doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(a.doc_id, a.assignee_id ?? null, a.uploaded_by, a.kind || 'document', a.orig_name, a.mime_type, a.size_bytes, a.note ?? null, a.data, a.created_at).lastInsertRowid),
    attachmentById: (id) => plain(db.prepare('SELECT id, doc_id, assignee_id, uploaded_by, kind, orig_name, mime_type, size_bytes, note, created_at FROM attachments WHERE id = ?').get(id)),
    attachmentBlobById: (id) => plain(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id)),
    deleteAttachment: (id) => db.prepare('DELETE FROM attachments WHERE id = ?').run(id).changes,

    // ---- SMS navbati / audit ----
    enqueueSms: (s) => db.prepare('INSERT INTO sms_queue (to_name, text, at, status) VALUES (?,?,?,?)').run(s.to, s.text, s.at, s.status || 'navbatda'),
    enqueueSmsPhone: (s) => db.prepare('INSERT INTO sms_queue (to_name, to_phone, text, at, status) VALUES (?,?,?,?,?)').run(s.to, s.phone ?? null, s.text, s.at, s.status || 'navbatda'),
    listSms: () => plainAll(db.prepare('SELECT to_name AS "to", text, at, status FROM sms_queue ORDER BY id').all()),
    updateSmsStatus: (id, status, error) => db.prepare('UPDATE sms_queue SET status = ?, error = ? WHERE id = ?').run(status, error ?? null, id),
    pendingSms: (limit = 50) => plainAll(db.prepare("SELECT * FROM sms_queue WHERE status = 'navbatda' ORDER BY id LIMIT ?").all(limit)),
    insertAudit: (e) => db.prepare('INSERT INTO audit_log (at, user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)')
      .run(e.at, e.user_id ?? null, e.action, e.entity ?? null, e.entity_id ?? null, e.details ? JSON.stringify(e.details) : null, e.ip ?? null),
    listAudit({ limit, offset }) {
      const total = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
      const rows = plainAll(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset))
        .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
      return { rows, total };
    },

    // ---- ko'rish vaqtini qayd etish ----
    setViewed: (assigneeId, userId, viewedAt) =>
      db.prepare('UPDATE assignees SET viewed_at = ? WHERE id = ? AND user_id = ? AND viewed_at IS NULL').run(viewedAt, assigneeId, userId).changes,

    // ---- delegatsiya (uzatish) ----
    delegate: (assigneeId, toUserId, note, at) =>
      db.prepare('UPDATE assignees SET delegated_to = ?, delegated_at = ?, delegation_note = ? WHERE id = ?').run(toUserId, at, note ?? null, assigneeId).changes,

    // ---- doc_events (hayot sikli) ----
    insertEvent: (e) => Number(db.prepare('INSERT INTO doc_events (doc_id, user_id, event_type, details, created_at) VALUES (?,?,?,?,?)').run(e.doc_id, e.user_id ?? null, e.event_type, e.details ? JSON.stringify(e.details) : null, e.created_at).lastInsertRowid),
    listEvents: (docId) => plainAll(db.prepare('SELECT e.*, u.name as user_name FROM doc_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.doc_id = ? ORDER BY e.id').all(docId))
      .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),

    // ---- integratsiya sozlamalari ----
    getIntegration: (key) => { const r = plain(db.prepare('SELECT * FROM integration_settings WHERE key = ?').get(key)); return r && r.value ? { ...r, value: JSON.parse(r.value) } : r; },
    listIntegrations: () => plainAll(db.prepare('SELECT * FROM integration_settings ORDER BY key').all()).map((r) => ({ ...r, value: r.value ? JSON.parse(r.value) : null })),
    setIntegration: (key, value, updatedBy, updatedAt) =>
      db.prepare('INSERT INTO integration_settings (key, value, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by')
        .run(key, value ? JSON.stringify(value) : null, updatedAt, updatedBy),
    deleteIntegration: (key) => db.prepare('DELETE FROM integration_settings WHERE key = ?').run(key).changes,

    // ---- bildirishnomalar ----
    insertNotification: (n) => Number(db.prepare('INSERT INTO notifications (user_id, doc_id, type, title, body, read, created_at) VALUES (?,?,?,?,?,0,?)').run(n.user_id ?? null, n.doc_id ?? null, n.type, n.title, n.body ?? null, n.created_at).lastInsertRowid),
    listNotifications: (userId, limit = 30) => plainAll(db.prepare('SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit)),
    countUnread: (userId) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE (user_id IS NULL OR user_id = ?) AND read = 0').get(userId).n,
    markRead: (id, userId) => db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND (user_id IS NULL OR user_id = ?)').run(id, userId).changes,
    markAllRead: (userId) => db.prepare('UPDATE notifications SET read = 1 WHERE (user_id IS NULL OR user_id = ?) AND read = 0').run(userId).changes,

    ping: () => db.prepare('SELECT 1 AS ok').get().ok === 1,
  };
}
