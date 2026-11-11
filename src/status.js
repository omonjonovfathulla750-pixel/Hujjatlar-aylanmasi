// Holat mantig'i (frontend bilan bir xil qoidalar). Sof funksiyalar, DB'ga bog'liq emas.
import { daysBetween } from './dates.js';

export const STATUS_ORDER = ['late', 'prog', 'new', 'ok'];

export function assigneeStatus(a, task, today) {
  if (a.done_date) return a.done_date <= task.deadline ? 'ok' : 'late';
  return today > task.deadline ? 'late' : 'prog';
}

export function taskStatus(task, today) {
  if (!task.assignees.length) return 'new';
  const s = task.assignees.map((a) => assigneeStatus(a, task, today));
  if (s.includes('late')) return 'late';
  if (s.includes('prog')) return 'prog';
  return 'ok';
}

// 'sent' | 'signed' | 'signing'
export function docStatus(doc) {
  if (doc.transfers.length) return 'sent';
  return doc.signatures.every((s) => s.signed_at) ? 'signed' : 'signing';
}

// tasks: [{ date, status, assignees: [{done_date}] }]
export function summarize(tasks) {
  const c = { ok: 0, late: 0, prog: 0, new: 0 };
  const spans = [];
  for (const t of tasks) {
    c[t.status] += 1;
    for (const a of t.assignees) if (a.done_date) spans.push(daysBetween(t.date, a.done_date));
  }
  const total = tasks.length;
  return {
    ...c,
    total,
    pct: total ? Math.round((c.ok / total) * 100) : 0,
    avg_days: spans.length ? Math.round((spans.reduce((x, y) => x + y, 0) / spans.length) * 10) / 10 : 0,
  };
}
