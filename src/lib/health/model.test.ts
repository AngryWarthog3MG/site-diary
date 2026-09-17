import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestPerPerson, programmesDue, retainUntil, leadNotifyBy, leadNotifiedLate } from './model.ts';

const r = (program_id: string, person_name: string, monitored_on: string, next_due_on: string | null) => ({ program_id, person_name, monitored_on, next_due_on });

test('a newer report replaces the next-due date the older one set', () => {
  const recs = [r('lead', 'Evan Burke', '2026-03-01', '2026-09-01'), r('lead', 'evan  burke', '2026-09-10', '2027-03-10')];
  assert.equal(latestPerPerson(recs).length, 1);
  assert.deepEqual(programmesDue(recs, '2026-09-16'), []);
});

test('due counts per programme, with no names in them', () => {
  const due = programmesDue([
    r('lead', 'Evan Burke', '2026-03-01', '2026-09-01'),
    r('lead', 'Marcus Hayden', '2026-03-20', '2026-09-20'),
    r('lead', 'AJ', '2026-09-01', '2027-03-01'),
    r('asb', 'Evan Burke', '2025-09-20', null),
  ], '2026-09-16');
  assert.deepEqual(due, [{ programId: 'lead', overdue: 1, dueSoon: 1, earliestDue: '2026-09-01' }]);
  assert.ok(!JSON.stringify(due).includes('Evan'));
});

test('kept 30 years, or 40 for asbestos, as the database stamps it', () => {
  assert.equal(retainUntil('2026-09-01', false), '2056-09-01');
  assert.equal(retainUntil('2026-09-01', true), '2066-09-01');
  assert.equal(retainUntil('2024-02-29', false), '2054-02-28');
});

test('lead risk work is notified within seven days', () => {
  assert.equal(leadNotifyBy('2026-09-28'), '2026-10-05');
});

test('a person whose monitoring ended after their latest record is not due; an older end does not hide a newer record', () => {
  const recs = [r('lead', 'Evan Burke', '2026-03-01', '2026-09-01')];
  assert.deepEqual(programmesDue(recs, '2026-09-16', [{ program_id: 'lead', person_name: 'evan burke', ended_on: '2026-06-30' }]), []);
  assert.equal(programmesDue(recs, '2026-09-16', [{ program_id: 'lead', person_name: 'Evan Burke', ended_on: '2026-01-01' }]).length, 1);
});

test('a lead notification after seven days is late, not refused', () => {
  assert.equal(leadNotifiedLate('2026-09-01', '2026-09-08'), false);
  assert.equal(leadNotifiedLate('2026-09-01', '2026-09-10'), true);
});
