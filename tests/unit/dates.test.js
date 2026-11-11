import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, isDate, todayIn } from '../../src/dates.js';

test('isDate: haqiqiy sanalarni qabul qiladi, noto‘g‘rilarini rad etadi', () => {
  assert.equal(isDate('2026-11-07'), true);
  assert.equal(isDate('2024-02-29'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '07.11.2026', '', null, undefined, 20261107, '2026-11-07T00:00']) {
    assert.equal(isDate(bad), false, String(bad));
  }
});

test('addDays va daysBetween oy/yil chegarasida to‘g‘ri ishlaydi', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-07', 0), '2026-11-07');
  assert.equal(daysBetween('2026-11-01', '2026-11-07'), 6);
  assert.equal(daysBetween('2026-11-07', '2026-11-01'), -6);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('todayIn: vaqt zonasiga qarab sana o‘zgaradi (Toshkent UTC+5)', () => {
  const late = new Date('2026-11-07T20:30:00Z'); // Toshkentda 08-noyabr 01:30
  assert.equal(todayIn('UTC', late), '2026-11-07');
  assert.equal(todayIn('Asia/Tashkent', late), '2026-11-08');
});
