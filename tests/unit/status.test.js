import test from 'node:test';
import assert from 'node:assert/strict';
import { assigneeStatus, docStatus, summarize, taskStatus } from '../../src/status.js';

const task = (deadline, assignees = []) => ({ deadline, assignees });

test('assigneeStatus: bajarilgan / kechikkan / jarayonda', () => {
  const t = task('2026-11-10');
  assert.equal(assigneeStatus({ done_date: '2026-11-10' }, t, '2026-11-20'), 'ok'); // muddat kuni — vaqtida
  assert.equal(assigneeStatus({ done_date: '2026-11-11' }, t, '2026-11-20'), 'late');
  assert.equal(assigneeStatus({ done_date: null }, t, '2026-11-10'), 'prog'); // muddat kuni hali jarayonda
  assert.equal(assigneeStatus({ done_date: null }, t, '2026-11-11'), 'late');
});

test('taskStatus: eng yomon holat ustun (late > prog > ok), bajaruvchisiz = new', () => {
  const d = '2026-11-10';
  assert.equal(taskStatus(task(d, []), '2026-11-01'), 'new');
  assert.equal(taskStatus(task(d, [{ done_date: '2026-11-02' }]), '2026-11-05'), 'ok');
  assert.equal(taskStatus(task(d, [{ done_date: '2026-11-02' }, { done_date: null }]), '2026-11-05'), 'prog');
  assert.equal(taskStatus(task(d, [{ done_date: null }, { done_date: '2026-11-12' }]), '2026-11-05'), 'late');
});

test('docStatus: yuborilgan > imzolangan > imzolanmoqda', () => {
  assert.equal(docStatus({ transfers: [{}], signatures: [{ signed_at: null }] }), 'sent');
  assert.equal(docStatus({ transfers: [], signatures: [{ signed_at: 'x' }, { signed_at: 'y' }] }), 'signed');
  assert.equal(docStatus({ transfers: [], signatures: [{ signed_at: 'x' }, { signed_at: null }] }), 'signing');
  assert.equal(docStatus({ transfers: [], signatures: [] }), 'signed');
});

test('summarize: hisob, foiz va o‘rtacha kun', () => {
  const s = summarize([
    { date: '2026-11-01', status: 'ok', assignees: [{ done_date: '2026-11-03' }] },
    { date: '2026-11-01', status: 'late', assignees: [{ done_date: '2026-11-05' }, { done_date: null }] },
    { date: '2026-11-02', status: 'new', assignees: [] },
    { date: '2026-11-02', status: 'prog', assignees: [{ done_date: null }] },
  ]);
  assert.deepEqual({ ok: s.ok, late: s.late, prog: s.prog, new: s.new, total: s.total }, { ok: 1, late: 1, prog: 1, new: 1, total: 4 });
  assert.equal(s.pct, 25);
  assert.equal(s.avg_days, 3); // (2 + 4) / 2
});

test('summarize: bo‘sh ro‘yxatda NaN bo‘lmaydi', () => {
  assert.deepEqual(summarize([]), { ok: 0, late: 0, prog: 0, new: 0, total: 0, pct: 0, avg_days: 0 });
});
