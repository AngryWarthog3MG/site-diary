import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimesheet, makeResolver, readWeek, weekOf, weekDays, normName, fmtHours, hoursFromClocks, officeFact, officeJobId, type LabourFact, type OfficeTime } from './model.ts';

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

test('one person across jobs: each job keeps its own nicknames, the company list applies everywhere, spellings shown (R107)', () => {
  const resolve = makeResolver(
    [{ projectId: 'p1', name: 'Matthew Rodgers', aliases: ['Matty', 'Matt'] }],
    [{ alias: 'Matt Rodgers', name: 'Matthew Rodgers' }],
  );
  assert.equal(resolve('matty', 'p1'), 'Matthew Rodgers');
  assert.equal(resolve('Matt', 'p2'), 'Matt'); // another job's Matt is not assumed to be him
  assert.equal(resolve('matt  rodgers', 'p2'), 'Matthew Rodgers');
  assert.equal(resolve('Evan Burke', 'p1'), 'Evan Burke');
  const facts = [
    fact({ date: '2026-09-23', personName: resolve('Matthew Rodgers', 'p1'), hours: 9 }),
    fact({ date: '2026-09-24', projectId: 'p2', projectCode: 'C002', personName: resolve('Matt Rodgers', 'p2'), saidAs: 'Matt Rodgers', hours: 10, entryId: 'e2' }),
  ];
  const sheet = buildTimesheet(facts, '2026-09-21');
  assert.equal(sheet.people.length, 1);
  assert.equal(sheet.people[0].name, 'Matthew Rodgers');
  assert.deepEqual(sheet.people[0].aka, ['Matt Rodgers']);
  assert.equal(sheet.people[0].total, 19);
});

test('two jobs at the same time on one day is flagged; two jobs one after the other is not', () => {
  const sheet = buildTimesheet([
    fact({ date: '2026-09-25', hours: 9.05, start: '06:30', finish: '15:33' }),
    fact({ date: '2026-09-25', projectId: 'p2', projectCode: 'C002', hours: 10, start: '06:30', finish: '16:30', entryId: 'e2' }),
    fact({ date: '2026-09-24', hours: 4, start: '06:00', finish: '10:00', entryId: 'e3' }),
    fact({ date: '2026-09-24', projectId: 'p2', projectCode: 'C002', hours: 5, start: '10:30', finish: '15:30', entryId: 'e4' }),
    fact({ date: '2026-09-23', hours: 8, entryId: 'e5' }),
    fact({ date: '2026-09-23', projectId: 'p2', projectCode: 'C002', hours: 8, entryId: 'e6' }),
  ], '2026-09-21');
  const p = sheet.people[0];
  assert.equal(p.days['2026-09-25'].clash, true);
  assert.equal(p.days['2026-09-24'].clash, false);
  assert.equal(p.days['2026-09-23'].clash, true); // no clocks, 16 h across two jobs
  assert.equal(sheet.clashes, 2);
});

const office = (over: Partial<OfficeTime>): OfficeTime => ({
  id: 'o1', orgId: 'org', personName: 'Evan Burke', date: '2026-09-29', start: '06:30', finish: '13:00', breakMins: 0, hours: 6.5,
  place: 'Office', note: null, addedBy: 'Mitchell Van Zyl', addedAt: '2026-10-05T02:00:00Z', voidedAt: null, voidReason: null, ...over,
});

test('hours between two clocks, less the break — and never a guess', () => {
  assert.equal(hoursFromClocks('06:30', '13:00'), 6.5);
  assert.equal(hoursFromClocks('06:30', '15:00', 30), 8);
  assert.equal(hoursFromClocks('06:30:00', '16:30:00'), 10);
  assert.equal(hoursFromClocks('06:30', null), null);
  assert.equal(hoursFromClocks('', '13:00'), null);
  assert.equal(hoursFromClocks('13:00', '06:30'), null); // past midnight is typed as hours, not assumed
  assert.equal(hoursFromClocks('06:30', '07:00', 30), null);
});

test('time the office adds is on the sheet, counted in the totals and said apart (README R122)', () => {
  const sheet = buildTimesheet([
    officeFact(office({})),
    officeFact(office({ id: 'o2', personName: 'Matthew Rodgers' })),
    fact({ personName: 'Evan Burke', date: '2026-09-30', hours: 10, entryId: 'e30' }),
  ], '2026-09-28');
  const evan = sheet.people.find((p) => p.name === 'Evan Burke')!;
  assert.equal(evan.total, 16.5);
  assert.deepEqual(evan.byJob, { Office: 6.5, C001: 10 });
  const tue = evan.days['2026-09-29'];
  assert.equal(tue.hours, 6.5);
  assert.equal(tue.added, 1);
  assert.deepEqual(tue.entryIds, []); // no diary behind it, so nothing to link to
  assert.equal(tue.unsigned, false);
  assert.deepEqual(tue.jobs, ['Office']);
  assert.equal(evan.days['2026-09-30'].added, 0);
  assert.equal(sheet.addedRows, 2);
  assert.equal(sheet.addedHours, 13);
  assert.equal(sheet.total, 23);
  assert.equal(sheet.dayTotals['2026-09-29'], 13);
  // The place is listed after the jobs and marked as not a job.
  assert.deepEqual(sheet.jobs.map((j) => [j.code, Boolean(j.office), j.hours, j.people]), [['C001', false, 10, 1], ['Office', true, 13, 2]]);
  assert.equal(sheet.jobs[1].projectId, officeJobId(' office '));
});

test('an added line follows the company\'s list of names, and clashes with a diary at the same clocks', () => {
  const resolve = makeResolver([], [{ alias: 'Matt Rodgers', name: 'Matthew Rodgers' }]);
  const f = officeFact(office({ personName: 'Matt Rodgers' }), (n) => resolve(n, ''));
  assert.equal(f.personName, 'Matthew Rodgers');
  assert.equal(f.saidAs, 'Matt Rodgers');
  const sheet = buildTimesheet([
    f,
    fact({ personName: 'Matthew Rodgers', date: '2026-09-29', hours: 10, start: '06:30', finish: '16:30', entryId: 'e29' }),
  ], '2026-09-28');
  assert.equal(sheet.people.length, 1);
  assert.equal(sheet.people[0].days['2026-09-29'].clash, true); // at the office and on site at once: someone should check
  assert.equal(sheet.clashes, 1);
  // After the site day is no clash.
  const later = buildTimesheet([
    officeFact(office({ personName: 'Matthew Rodgers', start: '17:00', finish: '19:00', hours: 2 })),
    fact({ personName: 'Matthew Rodgers', date: '2026-09-29', hours: 10, start: '06:30', finish: '16:30', entryId: 'e29' }),
  ], '2026-09-28');
  assert.equal(later.clashes, 0);
  assert.equal(later.people[0].days['2026-09-29'].hours, 12);
});
