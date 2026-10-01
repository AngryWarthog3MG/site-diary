import test from 'node:test';
import assert from 'node:assert/strict';
import { coverage } from './model.ts';

test('coverage tells who has read the current version, by name however spaced', () => {
  const c = coverage(['Danny Rowe', 'Sam Whitely', 'Kel Brady'], ['danny  rowe', 'KEL BRADY']);
  assert.deepEqual(c.read, ['Danny Rowe', 'Kel Brady']);
  assert.deepEqual(c.unread, ['Sam Whitely']);
});

import { complianceSummary, dueState, parseImportFilename, wantsReminder, audienceText } from './model.ts';

test('due state: overdue, due soon within three days, otherwise to read; done states pass through', () => {
  assert.equal(dueState({ status: 'pending', due_on: '2026-09-30' }, '2026-10-01'), 'overdue');
  assert.equal(dueState({ status: 'pending', due_on: '2026-10-03' }, '2026-10-01'), 'due_soon');
  assert.equal(dueState({ status: 'pending', due_on: '2026-10-20' }, '2026-10-01'), 'due');
  assert.equal(dueState({ status: 'signed', due_on: '2026-09-01' }, '2026-10-01'), 'signed');
  assert.equal(dueState({ status: 'waived', due_on: '2026-09-01' }, '2026-10-01'), 'waived');
});

test('compliance counts only what still counts: signed and pending; waived and superseded are out of it', () => {
  const s = complianceSummary([
    { status: 'signed', due_on: '2026-09-01' }, { status: 'signed', due_on: '2026-09-01' },
    { status: 'pending', due_on: '2026-09-20' }, { status: 'pending', due_on: '2026-10-30' },
    { status: 'waived', due_on: '2026-09-01' }, { status: 'superseded', due_on: '2026-08-01' },
  ], '2026-10-01');
  assert.deepEqual(s, { due: 4, signed: 2, overdue: 1, pending: 2, percent: 50 });
  assert.equal(complianceSummary([], '2026-10-01').percent, null);
});

test('reminders: three days out or overdue, never twice in 48 hours', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.equal(wantsReminder({ status: 'pending', due_on: '2026-10-03', last_reminded_at: null }, now), true);
  assert.equal(wantsReminder({ status: 'pending', due_on: '2026-10-03', last_reminded_at: '2026-09-30T20:00:00Z' }, now), false);
  assert.equal(wantsReminder({ status: 'pending', due_on: '2026-09-20', last_reminded_at: '2026-09-28T12:00:00Z' }, now), true);
  assert.equal(wantsReminder({ status: 'pending', due_on: '2026-10-20', last_reminded_at: null }, now), false);
  assert.equal(wantsReminder({ status: 'signed', due_on: '2026-09-20', last_reminded_at: null }, now), false);
});

test('import filenames: code, title, kind and version read off the name; nothing guessed', () => {
  assert.deepEqual(parseImportFilename('POL-002 Code of Conduct v4.pdf'), { code: 'POL-002', title: 'Code of Conduct', kind: 'policy', versionNote: '4' });
  assert.deepEqual(parseImportFilename('SOP 014 - Trench shoring Rev 2.1.PDF'), { code: 'SOP-014', title: 'Trench shoring', kind: 'procedure', versionNote: '2.1' });
  assert.deepEqual(parseImportFilename('Fitness_for_work_policy.pdf'), { code: null, title: 'Fitness for work policy', kind: 'policy', versionNote: null });
  assert.deepEqual(parseImportFilename('Site induction checklist.pdf'), { code: null, title: 'Site induction checklist', kind: 'form', versionNote: null });
  assert.deepEqual(parseImportFilename('Something else.pdf'), { code: null, title: 'Something else', kind: null, versionNote: null });
});

test('audience in words', () => {
  assert.equal(audienceText([]), 'Everyone on the company’s jobs');
  assert.equal(audienceText(['supervisor', 'labourer']), 'Supervisors, Labourers');
});
