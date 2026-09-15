import test from 'node:test';
import assert from 'node:assert/strict';
import { perthWindowDate, perthWindowEnd, perthWindowStart } from './window.ts';

test('a 30-day Perth window opens at Perth midnight 29 days back, so today is the 30th day', () => {
  assert.equal(perthWindowDate('2026-09-15', 30), '2026-08-17');
  // Perth midnight on 17 Aug is 16:00 UTC on 16 Aug.
  assert.equal(perthWindowStart('2026-09-15', 30), '2026-08-16T16:00:00.000Z');
  // 06:30 AWST on the first morning of the window is inside it; 23:00 AWST the night before is not.
  assert.ok('2026-08-16T22:30:00Z' >= perthWindowStart('2026-09-15', 30));
  assert.ok('2026-08-16T15:00:00Z' < perthWindowStart('2026-09-15', 30));
});
test('the date and the instant agree, and a one-day window is today alone', () => {
  assert.equal(perthWindowDate('2026-09-15', 1), '2026-09-15');
  assert.equal(perthWindowStart('2026-09-15', 1), '2026-09-14T16:00:00.000Z');
  assert.equal(perthWindowDate('2026-09-15', 7), '2026-09-09');
  assert.equal(perthWindowDate('2026-09-15', 90), '2026-06-18');
  assert.equal(perthWindowDate('2026-09-15', 365), '2025-09-16');
  assert.equal(perthWindowStart('2026-09-15', 365).slice(0, 10), '2025-09-15');
});
test('the window closes at the end of today, Perth time, so a future-dated row stays out', () => {
  assert.equal(perthWindowEnd('2026-09-15'), '2026-09-15T16:00:00.000Z');
  assert.ok('2026-09-15T15:59:00Z' < perthWindowEnd('2026-09-15'), '23:59 AWST today is in');
  assert.ok('2026-09-15T16:00:00Z' >= perthWindowEnd('2026-09-15'), 'midnight tomorrow is out');
});
