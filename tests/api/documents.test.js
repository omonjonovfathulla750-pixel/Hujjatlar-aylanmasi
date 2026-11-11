import test from 'node:test';
import assert from 'node:assert/strict';
import { id, newDoc, setupRoles, startTestApp } from '../helpers.js';

async function env(opts) {
  const t = await startTestApp(opts);
  setupRoles(t);
  const admin = await t.tokenFor('admin');
  return { t, admin, close: () => t.close() };
}

test('hujjat hayot sikli: yaratish → o‘qish → tahrirlash → o‘chirish', async () => {
  const { t, admin, close } = await env();
  try {
    const c = await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'API-1', assignee: id(t, 'U001'), signers: [id(t, 'U004')] }) });
    assert.equal(c.status, 201);
    assert.equal(c.body.number, 'API-1');
    assert.equal(c.body.status, 'signing');
    assert.equal(c.body.tasks[0].assignees[0].status, 'prog');
    assert.equal(c.body.signatures[0].ord, 1);

    const g = await t.api('GET', `/documents/${c.body.id}`, { token: admin });
    assert.equal(g.status, 200);
    assert.equal(g.body.title, 'Sinov hujjati');

    const p = await t.api('PATCH', `/documents/${c.body.id}`, { token: admin, body: { title: 'Yangilangan' } });
    assert.equal(p.status, 200);
    assert.equal(p.body.title, 'Yangilangan');

    const d = await t.api('DELETE', `/documents/${c.body.id}`, { token: admin });
    assert.equal(d.status, 204);
    assert.equal(d.text, '');
    assert.equal((await t.api('GET', `/documents/${c.body.id}`, { token: admin })).status, 404);
    assert.equal((await t.api('DELETE', `/documents/${c.body.id}`, { token: admin })).status, 404);
  } finally { await close(); }
});

test('yaratish: validatsiya xatolari 422 va aniq maydon yo‘li bilan', async () => {
  const { t, admin, close } = await env();
  try {
    const r = await t.api('POST', '/documents', { token: admin, body: { number: '', type: 'Noma‘lum', org_id: 'a', deadline: '2026-02-30', title: 'x'.repeat(501), signers: [1, 'x'], assignee: 'y' } });
    assert.equal(r.status, 422);
    const paths = r.body.details.map((d) => d.path).sort();
    assert.deepEqual(paths, ['assignee', 'deadline', 'number', 'org_id', 'signers[1]', 'title', 'type']);
    assert.ok(r.body.request_id);
    assert.equal((await t.api('POST', '/documents', { token: admin, body: newDoc({ signers: Array(21).fill(1) }) })).status, 422);
    assert.equal((await t.api('POST', '/documents', { token: admin, body: newDoc({ extra: 1 }) })).status, 422);
    assert.equal((await t.api('POST', '/documents', { token: admin, body: newDoc({ deadline: '2026-11-06' }) })).status, 422); // o‘tgan sana
  } finally { await close(); }
});

test('yaratish: dublikat raqam 409; bo‘shliqlar kesiladi', async () => {
  const { t, admin, close } = await env();
  try {
    const a = await t.api('POST', '/documents', { token: admin, body: newDoc({ number: '  D-1  ' }) });
    assert.equal(a.body.number, 'D-1');
    assert.equal((await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'D-1' }) })).status, 409);
  } finally { await close(); }
});

test('XSS ko‘rinishidagi matn bazada o‘zgarishsiz saqlanadi (chiqarishda frontend esc() qiladi), SQL-inyeksiya ishlamaydi', async () => {
  const { t, admin, close } = await env();
  try {
    const evil = '<img src=x onerror=alert(1)>"\'; DROP TABLE documents; --';
    const c = await t.api('POST', '/documents', { token: admin, body: newDoc({ title: evil }) });
    assert.equal(c.status, 201);
    assert.equal(c.body.title, evil);
    assert.equal((await t.api('GET', '/documents', { token: admin })).body.meta.total, 1); // jadval joyida
  } finally { await close(); }
});

test('ro‘yxat: sahifalash, qidiruv va filtrlar', async () => {
  const { t, admin, close } = await env();
  try {
    for (let i = 1; i <= 5; i += 1) {
      await t.api('POST', '/documents', { token: admin, body: newDoc({ number: `L-${i}`, org_id: i % 2 ? 1 : 2, title: i === 3 ? 'Maxsus mazmun' : 'Oddiy' }) });
    }
    const p1 = await t.api('GET', '/documents?per_page=2&page=1', { token: admin });
    assert.deepEqual(p1.body.meta, { page: 1, per_page: 2, total: 5, total_pages: 3 });
    assert.deepEqual(p1.body.data.map((d) => d.number), ['L-5', 'L-4']); // yangi birinchi
    const p3 = await t.api('GET', '/documents?per_page=2&page=3', { token: admin });
    assert.deepEqual(p3.body.data.map((d) => d.number), ['L-1']);
    assert.equal((await t.api('GET', '/documents?q=maxsus', { token: admin })).body.data[0].number, 'L-3');
    assert.equal((await t.api('GET', '/documents?org_id=2', { token: admin })).body.meta.total, 2);
    assert.equal((await t.api('GET', '/documents?status=new', { token: admin })).body.meta.total, 5);
    assert.equal((await t.api('GET', '/documents?doc_status=signed', { token: admin })).body.meta.total, 5); // imzolovchisiz
  } finally { await close(); }
});

test('ro‘yxat: noto‘g‘ri query parametrlari 422', async () => {
  const { t, admin, close } = await env();
  try {
    for (const q of ['page=0', 'page=abc', 'per_page=101', 'per_page=0', 'status=boshqa', 'doc_status=x', 'org_id=-1', 'date_from=2026-13-01', 'nomalum=1', 'q=' + 'a'.repeat(101)]) {
      const r = await t.api('GET', `/documents?${q}`, { token: admin });
      assert.equal(r.status, 422, q);
    }
    assert.equal((await t.api('GET', '/documents?date_from=2026-12-01&date_to=2026-01-01', { token: admin })).status, 422);
  } finally { await close(); }
});

test('yo‘l parametri: noto‘g‘ri id 404', async () => {
  const { t, admin, close } = await env();
  try {
    for (const p of ['abc', '0', '-5', '1.5', '99999999999999999999', '%00', '1%20OR%201=1']) {
      assert.equal((await t.api('GET', `/documents/${p}`, { token: admin })).status, 404, p);
    }
    assert.equal((await t.api('GET', '/documents/12345', { token: admin })).status, 404);
  } finally { await close(); }
});

test('imzolash va yuborish oqimi', async () => {
  const { t, admin, close } = await env();
  try {
    const c = await t.api('POST', '/documents', { token: admin, body: newDoc({ signers: [id(t, 'U001')] }) });
    const docId = c.body.id;
    const u1 = await t.tokenFor('U001');
    const u4 = await t.tokenFor('U004');
    assert.equal((await t.api('POST', `/documents/${docId}/sign`, { token: u4 })).status, 404); // aloqasi yo‘q: mavjudligi sezdirilmaydi
    const withAssignee = await t.api('POST', '/documents', { token: admin, body: newDoc({ assignee: id(t, 'U004') }) });
    assert.equal((await t.api('POST', `/documents/${withAssignee.body.id}/sign`, { token: u4 })).status, 403); // ko‘radi, lekin imzolovchi emas
    const s = await t.api('POST', `/documents/${docId}/sign`, { token: u1 });
    assert.equal(s.status, 200);
    assert.equal(s.body.status, 'signed');
    assert.equal((await t.api('POST', `/documents/${docId}/sign`, { token: u1 })).status, 403);

    assert.equal((await t.api('POST', `/documents/${docId}/send`, { token: admin, body: { org_id: 1 } })).status, 422);
    assert.equal((await t.api('POST', `/documents/${docId}/send`, { token: admin, body: {} })).status, 422);
    const sent = await t.api('POST', `/documents/${docId}/send`, { token: admin, body: { org_id: 2 } });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.status, 'sent');
    assert.equal((await t.api('POST', `/documents/${docId}/send`, { token: admin, body: { org_id: 2 } })).status, 409);
  } finally { await close(); }
});

test('topshiriq: bajaruvchi biriktirish va bajarilganini belgilash', async () => {
  const { t, admin, close } = await env();
  try {
    const c = await t.api('POST', '/documents', { token: admin, body: newDoc({ deadline: '2026-11-20' }) });
    const taskId = c.body.tasks[0].id;
    assert.equal(c.body.tasks[0].status, 'new');
    const a = await t.api('POST', `/tasks/${taskId}/assignees`, { token: admin, body: { user_id: id(t, 'U001') } });
    assert.equal(a.status, 201);
    assert.equal((await t.api('POST', `/tasks/${taskId}/assignees`, { token: admin, body: { user_id: id(t, 'U001') } })).status, 409);
    assert.equal((await t.api('POST', `/tasks/${taskId}/assignees`, { token: admin, body: {} })).status, 422);
    assert.equal((await t.api('POST', '/tasks/9999/assignees', { token: admin, body: { user_id: 1 } })).status, 404);

    const u1 = await t.tokenFor('U001');
    const done = await t.api('PATCH', `/assignees/${a.body.id}`, { token: u1, body: { done_date: '2026-11-07' } });
    assert.equal(done.status, 200);
    assert.equal((await t.api('GET', `/documents/${c.body.id}`, { token: admin })).body.tasks[0].status, 'ok');
    assert.equal((await t.api('PATCH', `/assignees/${a.body.id}`, { token: u1, body: { done_date: null } })).status, 200);
    assert.equal((await t.api('PATCH', `/assignees/${a.body.id}`, { token: u1, body: { done_date: '2026-11-30' } })).status, 422); // kelajak
    assert.equal((await t.api('PATCH', `/assignees/${a.body.id}`, { token: u1, body: {} })).status, 422);
    assert.equal((await t.api('PATCH', `/assignees/${a.body.id}`, { token: u1, body: { done_date: 'kecha' } })).status, 422);
    assert.equal((await t.api('PATCH', `/assignees/${a.body.id}`, { token: await t.tokenFor('U004'), body: { done_date: null } })).status, 403);
  } finally { await close(); }
});

test('topshiriqlar ro‘yxati va statistika', async () => {
  const { t, admin, close } = await env({ demo: true });
  try {
    const all = await t.api('GET', '/tasks?per_page=100', { token: admin });
    assert.equal(all.status, 200);
    assert.ok(all.body.meta.total > 100);
    const late = await t.api('GET', '/tasks?status=late&per_page=100', { token: admin });
    assert.ok(late.body.data.length > 0 && late.body.data.every((x) => x.status === 'late'));
    const nov = await t.api('GET', '/tasks?year=2026&month=11&per_page=100', { token: admin });
    assert.ok(nov.body.data.every((x) => x.date.startsWith('2026-11')));
    assert.equal((await t.api('GET', '/tasks?month=11', { token: admin })).status, 422);
    assert.equal((await t.api('GET', '/tasks?month=13&year=2026', { token: admin })).status, 422);

    const s = await t.api('GET', '/stats/summary?year=2026', { token: admin });
    assert.equal(s.status, 200);
    assert.equal(s.body.total, s.body.ok + s.body.late + s.body.prog + s.body.new);
    assert.equal(s.body.total, all.body.meta.total);
    assert.ok(s.body.pct >= 0 && s.body.pct <= 100);
  } finally { await close(); }
});

test('oddiy xodim: faqat o‘ziga tegishli hujjat va topshiriqlarni ko‘radi', async () => {
  const { t, admin, close } = await env();
  try {
    const mine = await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'P-1', assignee: id(t, 'U001') }) });
    const other = await t.api('POST', '/documents', { token: admin, body: newDoc({ number: 'P-2', assignee: id(t, 'U004') }) });
    const u1 = await t.tokenFor('U001');
    const list = await t.api('GET', '/documents', { token: u1 });
    assert.deepEqual(list.body.data.map((d) => d.number), ['P-1']);
    assert.equal((await t.api('GET', `/documents/${mine.body.id}`, { token: u1 })).status, 200);
    assert.equal((await t.api('GET', `/documents/${other.body.id}`, { token: u1 })).status, 404);
    assert.equal((await t.api('GET', '/tasks', { token: u1 })).body.meta.total, 1);
    assert.equal((await t.api('GET', '/stats/summary', { token: u1 })).body.total, 1);
  } finally { await close(); }
});

test('tana hajmi chegarasi: katta so‘rov 413', async () => {
  const { t, admin, close } = await env({ env: { BODY_LIMIT_BYTES: '500' } });
  try {
    const r = await t.api('POST', '/documents', { token: admin, body: newDoc({ title: 'x'.repeat(2000) }) });
    assert.equal(r.status, 413);
    assert.equal(r.body.code, 'payload_too_large');
    // chunked (Content-Length'siz) so‘rov ham cheklanadi
    const chunked = await fetch(`${t.base}/api/v1/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":"' + 'y'.repeat(2000) + '"}')); c.close(); } }), duplex: 'half',
    }).catch(() => null);
    if (chunked) assert.equal(chunked.status, 413);
    assert.equal((await t.api('GET', '/health')).status, 200); // server ishlashda davom etadi
  } finally { await close(); }
});
