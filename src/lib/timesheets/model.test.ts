import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimesheet, readWeek, weekOf, weekDays, normName, fmtHours, type LabourFact } from './model.ts';

const fact = (over: Partial<LabourFact>): LabourFact => ({
  entryId: 'e1', projectId: 'p1', projectCode: 'C001', projectName: 'Curtin', date: '2026-09-22', signed: true,
  personName: 'Drill Alpha', role: 'Labourer', hours: 8, overtimeHours: null, ...over,
});

test('weekOf snaps to the Monday; readWeek falls back to this week', () => {
  assert.equal(weekOf('2026-09-24'), '2026-09-21');
  assert.equal(weekOf('2026-09-27'), '2026-09-21'); // Sunday belongs to the week before
  assert.equal(weekOf('2026-09-21'), '2026-09-21');
  assert.deepEqual(weekDays('2026-09-21').at(-1), '2026-09-27');
  assert.equal(readWeek('2026-09-23', '2026-09-25'), '2026-09-21');
  assert.equal(readWeek('garbage', '2026-09-25'), '2026-09-21');
  assert.equal(readWeek(undefined, '2026-09-25'), '2026-09-21');
});

test('one person across two jobs is one row, with the jobs told apart', () => {
  const sheet = buildTimesheet([
    fact({ date: '2026-09-21', hours: 8 }),
    fact({ date: '2026-09-22', hours: 10, entryId: 'e2' }),
    fact({ date: '2026-09-23', hours: 4, projectId: 'p2', projectCode: 'C010', projectName: 'Kalgoorlie', entryId: 'e3' }),
    fact({ date: '2026-09-23', hours: 4, entryId: 'e4' }),
    fact({ personName: 'Drill Bravo', date: '2026-09-21', hours: 8, entryId: 'e1' }),
  ], '2026-09-21');
  assert.equal(sheet.people.length, 2);
  const alpha = sheet.people[0];
  assert.equal(alpha.name, 'Drill Alpha');
  assert.equal(alpha.total, 26);
  assert.deepEqual(alpha.byJob, { C001: 22, C010: 4 });
  assert.deepEqual(alpha.days['2026-09-23'].jobs, ['C010', 'C001']);
  assert.equal(alpha.days['2026-09-23'].hours, 8);
  assert.equal(sheet.total, 34);
  assert.equal(sheet.dayTotals['2026-09-21'], 16);
  assert.deepEqual(sheet.jobs.map((j) => [j.code, j.hours, j.people]), [['C001', 30, 2], ['C010', 4, 1]]);
});

test('spellings of one name fold together and the commonest is printed', () => {
  const sheet = buildTimesheet([
    fact({ personName: 'mitch', date: '2026-09-21' }),
    fact({ personName: 'Mitch ', date: '2026-09-22', entryId: 'e2' }),
    fact({ personName: 'Mitch', date: '2026-09-23', entryId: 'e3' }),
  ], '2026-09-21');
  assert.equal(sheet.people.length, 1);
  assert.equal(sheet.people[0].name, 'Mitch');
  assert.equal(normName('  Drill   Alpha '), 'drill alpha');
});

test('no hours is not recorded, never zero; an unsigned day is marked, not dropped', () => {
  const sheet = buildTimesheet([
    fact({ date: '2026-09-21', hours: null }),
    fact({ date: '2026-09-22', hours: 9, signed: false, entryId: 'e2' }),
  ], '2026-09-21');
  const p = sheet.people[0];
  assert.equal(p.days['2026-09-21'].hours, null);
  assert.equal(p.days['2026-09-21'].noHours, 1);
  assert.equal(p.total, 9);
  assert.equal(p.days['2026-09-22'].unsigned, true);
  assert.equal(sheet.noHours, 1);
  assert.equal(sheet.unsignedRows, 1);
  assert.equal(fmtHours(null), '—');
  assert.equal(fmtHours(10), '10');
  assert.equal(fmtHours(10.5), '10.5');
});

test('facts outside the week and blank names are left out; overtime is kept apart', () => {
  const sheet = buildTimesheet([
    fact({ date: '2026-09-20', hours: 8 }),
    fact({ date: '2026-09-28', hours: 8 }),
    fact({ personName: '   ', date: '2026-09-22', hours: 8 }),
    fact({ date: '2026-09-22', hours: 8, overtimeHours: 2 }),
  ], '2026-09-21');
  assert.equal(sheet.people.length, 1);
  assert.equal(sheet.total, 8);
  assert.equal(sheet.overtime, 2);
  assert.equal(sheet.people[0].overtime, 2);
});
