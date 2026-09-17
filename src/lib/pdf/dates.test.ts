import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, perthDate, fmtPerthDate } from './dates.ts';

test('an instant before 8 am in Perth is that Perth day, not the UTC day before', () => {
  // 06:30 AWST on 17/09 is 22:30 UTC on 16/09.
  assert.equal(perthDate('2026-09-16T22:30:00.000Z'), '2026-09-17');
  assert.equal(perthDate('2026-09-16T22:30:00+00:00'), '2026-09-17');
  assert.equal(fmtPerthDate('2026-09-16T22:30:00+00:00'), '17/09/2026');
});

test('later in the Perth day, and a bare date, are unchanged', () => {
  assert.equal(perthDate('2026-09-17T08:00:00.000Z'), '2026-09-17');
  assert.equal(perthDate('2026-09-17'), '2026-09-17');
  assert.equal(fmtDate('2026-09-17'), '17/09/2026');
});

test('nothing reads as a dash, never a guess', () => {
  assert.equal(fmtPerthDate(null), '—');
  assert.equal(perthDate(undefined), '');
});
