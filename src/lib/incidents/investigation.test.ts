import test from 'node:test';
import assert from 'node:assert/strict';
import { causeOptions, finishProblems, investigationDue, investigationExpected, nextWhySeq, orderWhys, BUILT_IN_ROOT_CAUSES } from './investigation.ts';

test('cause options: built-in first, the company\'s own after, a retired one marked, a clash with a built-in key dropped', () => {
  const opts = causeOptions('root_cause', [
    { kind: 'root_cause', key: 'exclusion_zone', label: 'No exclusion zone' },
    { kind: 'root_cause', key: 'old_one', label: 'Old', active: false },
    { kind: 'contributing_factor', key: 'rain', label: 'Rain' },
    { kind: 'root_cause', key: 'supervision', label: 'Dup of a built-in' },
  ]);
  assert.equal(opts.length, BUILT_IN_ROOT_CAUSES.length + 2);
  assert.equal(opts[0].custom, false);
  assert.deepEqual(opts.slice(-2).map((o) => [o.key, o.label, o.retired ?? false]), [['exclusion_zone', 'No exclusion zone', false], ['old_one', 'Old (retired)', true]]);
  assert.equal(opts.filter((o) => o.key === 'supervision').length, 1);
});

test('finish problems name what is missing; nothing missing is an empty list', () => {
  assert.deepEqual(finishProblems({ summary: null, findings: ' ' }, []), ['a summary of what happened', 'the findings', 'at least one root cause']);
  assert.deepEqual(finishProblems({ summary: 'x', findings: 'y' }, [{ kind: 'contributing_factor' }]), ['at least one root cause']);
  assert.deepEqual(finishProblems({ summary: 'x', findings: 'y' }, [{ kind: 'root_cause' }]), []);
});

test('due: overdue before today, due soon within three days, on track after, no date, done once finished', () => {
  const today = '2026-11-02';
  assert.equal(investigationDue({ status: 'open', due_on: '2026-11-01' }, today), 'overdue');
  assert.equal(investigationDue({ status: 'open', due_on: '2026-11-02' }, today), 'due_soon');
  assert.equal(investigationDue({ status: 'open', due_on: '2026-11-05' }, today), 'due_soon');
  assert.equal(investigationDue({ status: 'open', due_on: '2026-11-06' }, today), 'on_track');
  assert.equal(investigationDue({ status: 'open', due_on: null }, today), 'no_date');
  assert.equal(investigationDue({ status: 'finished', due_on: '2026-10-01' }, today), 'done');
  assert.equal(investigationDue({ status: 'signed_off', due_on: null }, today), 'done');
});

test('an investigation is expected for an injury, a notifiable event, or high/extreme severity — not a low hazard', () => {
  assert.equal(investigationExpected({ kind: 'injury', notifiable: false, actual_severity: null, potential_severity: null }), true);
  assert.equal(investigationExpected({ kind: 'hazard', notifiable: true, actual_severity: null, potential_severity: null }), true);
  assert.equal(investigationExpected({ kind: 'near_miss', notifiable: false, actual_severity: null, potential_severity: 'high' }), true);
  assert.equal(investigationExpected({ kind: 'hazard', notifiable: false, actual_severity: 'low', potential_severity: 'medium' }), false);
});

test('whys print in order and the next number follows the highest', () => {
  assert.deepEqual(orderWhys([{ seq: 3 }, { seq: 1 }]).map((w) => w.seq), [1, 3]);
  assert.equal(nextWhySeq([{ seq: 3 }, { seq: 1 }]), 4);
  assert.equal(nextWhySeq([]), 1);
});
