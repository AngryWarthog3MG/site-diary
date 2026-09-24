import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterShift, perthClock, shiftEndLabel, SHIFT_END_PERTH } from './shift.ts';

test('the site clock is Perth’s, not the device’s', () => {
  // 07:59 UTC is 15:59 in Perth (UTC+8, no daylight saving).
  assert.equal(perthClock(new Date('2026-09-24T07:59:00Z')), '15:59');
  assert.equal(perthClock(new Date('2026-09-24T08:00:00Z')), '16:00');
  assert.equal(perthClock(new Date('2026-09-24T16:00:00Z')), '00:00');
});

test('after the shift is from the end of the shift until midnight on site', () => {
  assert.equal(SHIFT_END_PERTH, '16:00');
  assert.equal(afterShift(new Date('2026-09-24T07:59:00Z')), false);
  assert.equal(afterShift(new Date('2026-09-24T08:00:00Z')), true);
  assert.equal(afterShift(new Date('2026-09-24T15:30:00Z')), true);   // 23:30 Perth
  assert.equal(afterShift(new Date('2026-09-24T16:30:00Z')), false);  // 00:30 Perth, the next day
  assert.equal(afterShift(new Date('2026-09-24T05:00:00Z'), '13:00'), true);
});

test('the label reads like a person says it', () => {
  assert.equal(shiftEndLabel('16:00'), '4 pm');
  assert.equal(shiftEndLabel('15:30'), '3:30 pm');
  assert.equal(shiftEndLabel('06:00'), '6 am');
});
