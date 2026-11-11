import test from 'node:test';
import assert from 'node:assert/strict';
import { id, newDoc, setupRoles, startTestApp } from '../helpers.js';

// Rollar: admin | operator (U002) | viewer (U003) | user (U001)
const ROLES = { admin: 'admin', operator: 'U002', viewer: 'U003', user: 'U001' };

test('har bir himoyalangan endpoint tokensiz va yaroqsiz token bilan 401 qaytaradi (barcha marshrutlar avtomatik)', async () => {
  const t = await startTestApp();
  try {
    const protectedRoutes = t.app.routes.filter((r) => r.auth !== false);
    assert.ok(protectedRoutes.length >= 15);
    for (const r of protectedRoutes) {
      const path = r.path.replace(/:\w+/g, '1');
      const body = r.body ? {} : undefined;
      const a = await t.api(r.method, path, { body });
      assert.equal(a.status, 401, `${r.method} ${r.path} tokensiz`);
      const b = await t.api(r.method, path, { body, token: 'yaroqsiz.token.qiymat' });
      assert.equal(b.status, 401, `${r.method} ${r.path} yaroqsiz token`);
    }
  } finally { await t.close(); }
});

test('ochiq endpointlar tokensiz ishlaydi', async () => {
  const t = await startTestApp();
  try {
    const open = t.app.routes.filter((r) => r.auth === false && r.method === 'GET');
    for (const r of open) assert.equal((await t.api('GET', r.path)).status, 200, r.path);
    assert.equal((await t.api('GET', '/openapi.json')).status, 200);
  } finally { await t.close(); }
});

test('rollar matritsasi: kim nima qila oladi', async () => {
  const t = await startTestApp();
  setupRoles(t);
  try {
    const tok = {};
    for (const [role, code] of Object.entries(ROLES)) tok[role] = await t.tokenFor(code);
    const mkDoc = async () => (await t.api('POST', '/documents', { token: tok.admin, body: newDoc() })).body;

    const matrix = [
      // [nom, so'rov yaratuvchi, {rol: kutilgan status}]
      ['GET /documents', () => ['GET', '/documents'], { admin: 200, operator: 200, viewer: 200, user: 200 }],
      ['GET /users', () => ['GET', '/users'], { admin: 200, operator: 200, viewer: 200, user: 200 }],
      ['GET /organizations', () => ['GET', '/organizations'], { admin: 200, operator: 200, viewer: 200, user: 200 }],
      ['GET /data', () => ['GET', '/data'], { admin: 200, operator: 200, viewer: 200, user: 200 }],
      ['GET /stats/summary', () => ['GET', '/stats/summary'], { admin: 200, operator: 200, viewer: 200, user: 200 }],
      ['GET /sms', () => ['GET', '/sms'], { admin: 200, operator: 200, viewer: 403, user: 403 }],
      ['GET /audit', () => ['GET', '/audit'], { admin: 200, operator: 403, viewer: 403, user: 403 }],
      ['POST /documents', () => ['POST', '/documents', newDoc()], { admin: 201, operator: 201, viewer: 403, user: 403 }],
      ['PATCH /documents/:id', async () => ['PATCH', `/documents/${(await mkDoc()).id}`, { title: 'Y' }], { admin: 200, operator: 200, viewer: 403, user: 403 }],
      ['DELETE /documents/:id', async () => ['DELETE', `/documents/${(await mkDoc()).id}`], { admin: 204, operator: 403, viewer: 403, user: 403 }],
      ['POST /documents/:id/send', async () => ['POST', `/documents/${(await mkDoc()).id}/send`, { org_id: 2 }], { admin: 200, operator: 200, viewer: 403, user: 403 }],
      ['POST /tasks/:id/assignees', async () => ['POST', `/tasks/${(await mkDoc()).tasks[0].id}/assignees`, { user_id: id(t, 'U004') }], { admin: 201, operator: 201, viewer: 403, user: 403 }],
    ];

    for (const [name, build, expected] of matrix) {
      for (const [role, status] of Object.entries(expected)) {
        const [method, path, body] = await build();
        const r = await t.api(method, path, { token: tok[role], body });
        assert.equal(r.status, status, `${name} — ${role}`);
      }
    }
  } finally { await t.close(); }
});

test('viewer hamma narsani ko‘radi, lekin hech narsani o‘zgartira olmaydi', async () => {
  const t = await startTestApp({ demo: true });
  setupRoles(t);
  try {
    const viewer = await t.tokenFor('U003');
    const admin = await t.tokenFor('admin');
    const total = (await t.api('GET', '/documents', { token: admin })).body.meta.total;
    assert.equal((await t.api('GET', '/documents', { token: viewer })).body.meta.total, total);
    const doc = (await t.api('GET', '/documents?per_page=1', { token: admin })).body.data[0];
    const assignee = doc.tasks[0]?.assignees[0];
    if (assignee) assert.equal((await t.api('PATCH', `/assignees/${assignee.id}`, { token: viewer, body: { done_date: null } })).status, 403);
    assert.equal((await t.api('POST', `/documents/${doc.id}/sign`, { token: viewer })).status, 403);
  } finally { await t.close(); }
});

test('ID kodlarini (users.code) faqat admin ko‘radi; parol hesh hech kimga ko‘rinmaydi', async () => {
  const t = await startTestApp();
  setupRoles(t);
  try {
    for (const [role, code] of Object.entries(ROLES)) {
      const r = await t.api('GET', '/users', { token: await t.tokenFor(code) });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.every((u) => typeof u.code === 'string'), role === 'admin', role);
      assert.ok(!r.text.includes('password') && !r.text.includes('scrypt'), role);
      const boot = await t.api('GET', '/data', { token: await t.tokenFor(code) });
      assert.ok(!boot.text.includes('password') && !boot.text.includes('scrypt'), `${role} /data`);
    }
  } finally { await t.close(); }
});

test('/data (UI uchun): oddiy xodim faqat o‘z hujjatlarini, SMS ni faqat admin/operator oladi', async () => {
  const t = await startTestApp({ demo: true });
  setupRoles(t);
  try {
    const admin = (await t.api('GET', '/data', { token: await t.tokenFor('admin') })).body;
    const user = (await t.api('GET', '/data', { token: await t.tokenFor('U001') })).body;
    assert.equal(admin.today, '2026-11-07');
    assert.equal(admin.me.role, 'admin');
    assert.equal(admin.orgs.length, 4);
    assert.equal(admin.users.length, 9);
    assert.ok(user.docs.length > 0 && user.docs.length < admin.docs.length);
    const uid = id(t, 'U001');
    for (const d of user.docs) {
      const related = d.created_by === uid || d.signatures.some((s) => s.user_id === uid) || d.tasks.some((x) => x.assignees.some((a) => a.user_id === uid));
      assert.ok(related, `hujjat ${d.number} U001 ga tegishli emas`);
    }
    assert.deepEqual(user.sms, []);
    assert.deepEqual((await t.api('GET', '/data', { token: await t.tokenFor('U003') })).body.sms, []);
    assert.ok(Array.isArray((await t.api('GET', '/data', { token: await t.tokenFor('U002') })).body.sms));
  } finally { await t.close(); }
});
