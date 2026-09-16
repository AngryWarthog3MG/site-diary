import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, nextDue, dueStatus, onTime, daysLate, sortItems, summarise, type ObligationItem } from './model.ts';

test('months add by the calendar, and clamp to the end of a shorter month', () => {
  assert.equal(addMonths('2026-01-15', 3), '2026-04-15');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-09-16', 60), '2031-09-16');
});

test('with nothing done yet, the first occurrence is due on the day set', () => {
  assert.equal(nextDue({ first_due_on: '2026-10-01', interval_months: 3, active: true }, []), '2026-10-01');
});

test('the next occurrence counts from when the last one was DONE, not when it was due', () => {
  const s = { first_due_on: '2026-01-01', interval_months: 3, active: true };
  // Done a month late: the next is three months from the late date, no grace.
  assert.equal(nextDue(s, [{ due_on: '2026-01-01', done_on: '2026-02-01' }]), '2026-05-01');
  // Done early: three months from the early date, so the gap never exceeds the maximum.
  assert.equal(nextDue(s, [{ due_on: '2026-04-01', done_on: '2026-03-10' }]), '2026-06-10');
});

test('the latest completion by date decides, whatever order they arrive in', () => {
  const s = { first_due_on: '2026-01-01', interval_months: 6, active: true };
  const c = [{ due_on: '2026-07-01', done_on: '2026-06-20' }, { due_on: '2026-01-01', done_on: '2026-01-02' }];
  assert.equal(nextDue(s, c), '2026-12-20');
});

test('a one-off that is done, or a retired schedule, has nothing further due', () => {
  assert.equal(nextDue({ first_due_on: '2026-01-01', interval_months: null, active: true }, [{ due_on: '2026-01-01', done_on: '2026-01-01' }]), null);
  assert.equal(nextDue({ first_due_on: '2026-01-01', interval_months: 3, active: false }, []), null);
  assert.equal(dueStatus(null, '2026-09-16'), 'done');
});

test('overdue is yesterday or before; due soon is within thirty days; upcoming is later', () => {
  assert.equal(dueStatus('2026-09-15', '2026-09-16'), 'overdue');
  assert.equal(dueStatus('2026-09-16', '2026-09-16'), 'due_soon');
  assert.equal(dueStatus('2026-10-16', '2026-09-16'), 'due_soon');
  assert.equal(dueStatus('2026-10-17', '2026-09-16'), 'upcoming');
});

test('on time means done by the day it was due, and lateness is counted in days', () => {
  assert.equal(onTime({ due_on: '2026-09-16', done_on: '2026-09-16' }), true);
  assert.equal(onTime({ due_on: '2026-09-16', done_on: '2026-09-19' }), false);
  assert.equal(daysLate({ due_on: '2026-09-16', done_on: '2026-09-19' }), 3);
  assert.equal(daysLate({ due_on: '2026-09-16', done_on: '2026-09-01' }), 0);
});

test('the list reads overdue first, earliest first, and summarises what needs attention', () => {
  const item = (key: string, status: ObligationItem['status'], dueOn: string | null): ObligationItem =>
    ({ key, source: 'scheduled', title: key, basis: null, dueOn, status, href: null });
  const sorted = sortItems([
    item('later', 'upcoming', '2027-01-01'),
    item('soon', 'due_soon', '2026-10-01'),
    item('late-2', 'overdue', '2026-09-10'),
    item('late-1', 'overdue', '2026-08-01'),
  ]);
  assert.deepEqual(sorted.map((i) => i.key), ['late-1', 'late-2', 'soon', 'later']);
  assert.deepEqual(summarise(sorted), { overdue: 2, dueSoon: 1, upcoming: 1, attention: 3 });
});
