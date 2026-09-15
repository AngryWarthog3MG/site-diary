import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimesheetCsv, timesheetFilename, buildTimesheetLongCsv, timesheetLongFilename } from './timesheet.ts';
import type { WeeklyData } from './load.ts';

const data = {
  project: { id: 'x', name: 'Curtin University', code: 'C001', orgCode: 'KBL' },
  start: '2026-08-24',
  end: '2026-08-25',
  days: ['2026-08-24', '2026-08-25'],
  entries: [{ entry_no: 'E1', entry_date: '2026-08-24', author_name: null, signed_at: null, notes: null }],
  labour: {
    people: [
      {
        name: 'Smith, Matty',
        role: 'supervisor',
        byDay: { '2026-08-24': 9 },
        days: { '2026-08-24': { ordinary: 8, overtime: 1, start: '06:30', finish: '16:00', ref: 'KBL-2026-08-24' } },
        hours: 8,
        overtime: 1,
        total: 9,
      },
      { name: 'Hamish', role: 'labourer', byDay: { '2026-08-25': 8 }, days: { '2026-08-25': { ordinary: 8, overtime: 0, start: null, finish: null, ref: 'KBL-2026-08-25' } }, hours: 8, overtime: 0, total: 8 },
    ],
    dayTotals: { '2026-08-24': 9, '2026-08-25': 8 },
    grandTotal: 17,
    overtimeTotal: 1,
  },
} as unknown as WeeklyData;

test('timesheet CSV lays out the matrix with quoted names and CRLF lines', () => {
  const csv = buildTimesheetCsv(data);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], 'Name,Role,2026-08-24,2026-08-25,Overtime,Total');
  assert.equal(lines[2], '"Smith, Matty",supervisor,9,,1,9');
  assert.equal(lines[3], 'Hamish,labourer,,8,,8');
  assert.equal(lines[4], 'Daily totals,,9,8,1,17');
  assert.ok(csv.endsWith('\r\n'));
});

test('filename carries project and range', () => {
  assert.equal(timesheetFilename(data), 'timesheet_C001_2026-08-24_2026-08-25.csv');
});

test('the payroll CSV is one line per person per day, ordinary and overtime apart, on the diary that stands behind it', () => {
  const csv = buildTimesheetLongCsv(data);
  const lines = csv.split('\r\n').filter(Boolean);
  assert.equal(lines[0], 'Job,Employee,Role,Date,Day,Start,Finish,Ordinary hours,Overtime hours,Total hours,Diary');
  assert.equal(lines[1], 'KBL_C001,Hamish,labourer,2026-08-25,Tue,,,8,,8,KBL-2026-08-25');
  assert.equal(lines[2], 'KBL_C001,"Smith, Matty",supervisor,2026-08-24,Mon,06:30,16:00,8,1,9,KBL-2026-08-24');
  assert.equal(lines.length, 3, 'a day with no hours is not a line');
  assert.equal(timesheetLongFilename(data), 'payroll_C001_2026-08-24_2026-08-25.csv');
});
