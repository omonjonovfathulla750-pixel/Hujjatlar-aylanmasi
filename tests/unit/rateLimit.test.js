import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../../src/rateLimit.js';

test('chegaradan oshganda bloklaydi, oyna tugagach tiklanadi', () => {
  let t = 1000;
  const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => t });
  assert.equal(rl.hit('a').allowed, true);
  assert.equal(rl.hit('a').remaining, 0);
  const third = rl.hit('a');
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSec >= 1);
  assert.equal(rl.hit('b').allowed, true); // kalitlar alohida
  t += 1001;
  assert.equal(rl.hit('a').allowed, true);
});

test('clear va size; ko‘p kalitda eskirganlar tozalanadi', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 10, max: 1, now: () => t });
  for (let i = 0; i < 10001; i += 1) rl.hit(`k${i}`);
  t = 100;
  rl.hit('yangi'); // yangi kalit → sweep ishga tushadi
  assert.ok(rl.size() < 10);
  rl.clear();
  assert.equal(rl.size(), 0);
});
