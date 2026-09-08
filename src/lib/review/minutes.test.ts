import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesBetween, fillDelayMinutes } from './minutes.ts';

test('minutes between two stated times, including a span past midnight', () => {
  assert.equal(minutesBetween('10:30', '12:30'), 120);
  assert.equal(minutesBetween('07:00', '07:15'), 15);
  assert.equal(minutesBetween('22:00', '01:00'), 180);
  assert.equal(minutesBetween('10:30:00', '11:00'), 30);
});

test('nothing is computed from a missing or malformed time', () => {
  assert.equal(minutesBetween(null, '12:30'), null);
  assert.equal(minutesBetween('10:30', undefined), null);
  assert.equal(minutesBetween('half ten', '12:30'), null);
  assert.equal(minutesBetween('', ''), null);
});

test('a stated duration is never overwritten; a null one is filled only from two times', () => {
  const rows = fillDelayMinutes([
    { start_time: '10:30', end_time: '12:30', duration_mins: null },
    { start_time: '10:30', end_time: '12:30', duration_mins: 90 }, // supervisor said ninety
    { start_time: '10:30', end_time: null, duration_mins: null },
    { start_time: null, end_time: null, duration_mins: null },
  ]);
  assert.deepEqual(rows.map((r) => r.duration_mins), [120, 90, null, null]);
});
