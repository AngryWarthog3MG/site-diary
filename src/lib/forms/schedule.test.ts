import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDue, addInterval, occurrences, scheduleState, remindDue, describeEvery } from './schedule.ts';

const weekly = { every: 1, unit: 'week' as const, first_due_on: '2026-01-05', active: true };

test('next due is the first due until one is done, then an interval from the DOING', () => {
  assert.equal(nextDue(weekly, null), '2026-01-05');
  // Done nine days late: a week from the doing, not two from the missed due.
  assert.equal(nextDue(weekly, '2026-01-14'), '2026-01-21');
  assert.equal(nextDue({ ...weekly, active: false }, '2026-01-14'), null);
});

test('a month from the 31st of January is the last day of February; days and weeks add plainly', () => {
  assert.equal(addInterval('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(addInterval('2024-01-31', 1, 'month'), '2024-02-29');
  assert.equal(addInterval('2026-11-30', 3, 'month'), '2027-02-28');
  assert.equal(addInterval('2026-12-30', 2, 'day'), '2027-01-01');
  assert.equal(addInterval('2026-01-05', 2, 'week'), '2026-01-19');
});

test('occurrences fill a window from the next due; an overdue one before it is not dragged in', () => {
  assert.deepEqual(occurrences(weekly, '2026-01-14', '2026-02-01', '2026-02-28'), ['2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25']);
  assert.deepEqual(occurrences(weekly, null, '2026-01-01', '2026-01-20'), ['2026-01-05', '2026-01-12', '2026-01-19']);
  assert.deepEqual(occurrences({ ...weekly, active: false }, null, '2026-01-01', '2026-01-31'), []);
  assert.equal(occurrences({ every: 1, unit: 'day', first_due_on: '2026-01-01', active: true }, null, '2026-01-01', '2026-12-31').length, 62, 'capped');
});

test('state and the nightly reminder', () => {
  assert.equal(scheduleState('2026-01-04', '2026-01-05'), 'overdue');
  assert.equal(scheduleState('2026-01-08', '2026-01-05'), 'due_soon');
  assert.equal(scheduleState('2026-01-09', '2026-01-05'), 'upcoming');
  assert.equal(scheduleState(null, '2026-01-05'), 'none');
  assert.equal(remindDue('2026-01-08', '2026-01-05', null), true);
  assert.equal(remindDue('2026-01-08', '2026-01-05', '2026-01-05'), false, 'told today already');
  assert.equal(remindDue('2026-01-08', '2026-01-05', '2026-01-04'), true, 'told yesterday, told again tonight');
  assert.equal(remindDue('2026-01-09', '2026-01-05', null), false);
  assert.equal(remindDue(null, '2026-01-05', null), false);
});

test('describing the interval', () => {
  assert.equal(describeEvery(1, 'day'), 'daily');
  assert.equal(describeEvery(1, 'week'), 'every week');
  assert.equal(describeEvery(2, 'week'), 'every 2 weeks');
  assert.equal(describeEvery(3, 'month'), 'every 3 months');
});
