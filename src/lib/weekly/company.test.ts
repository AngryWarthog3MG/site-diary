import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollUp, summariseJob, weekdaysBetween } from './company.ts';
import type { WeeklyData } from './load.ts';

const week = (over: { id: string; code: string; name?: string; hours?: number; people?: string[]; missing?: number; unsigned?: string[]; unnumbered?: number; docketless?: number; delays?: Array<{ category: string; minutes: number }> }): WeeklyData => ({
  project: { id: over.id, name: over.name ?? over.code, code: over.code, orgCode: 'KBL' },
  start: '2026-09-21', end: '2026-09-27', days: [],
  entries: [],
  labour: { people: (over.people ?? []).map((name) => ({ name, role: null, byDay: {}, days: {}, hours: 0, overtime: 0, total: 0 })), dayTotals: {}, grandTotal: over.hours ?? 0, overtimeTotal: 0 },
  plant: { rows: [], totalHours: 12, totalIdle: 1 },
  pours: { rows: [], totalVolume: 0 },
  workItems: { rows: [{ date: '2026-09-22', entry_no: 'x', area: 'Stage 1', description: 'Trenching', percent_complete: null }] },
  site_events: { rows: [] },
  dayworks: { rows: Array.from({ length: over.docketless ?? 0 }, () => ({ date: '2026-09-22', entry_no: 'x', description: 'd', labour: null, plant: null, materials: null, hours: 2, docket_ref: null, docket_added: null })), totalHours: 2 * (over.docketless ?? 0), unreferenced: 0 },
  quantities: { rows: [] },
  delays: { rows: [], byCategory: (over.delays ?? []).map((d) => ({ ...d, hours: d.minutes / 60 })), totalMinutes: 0, totalHours: 0 },
  weather: { rows: [], totalRainfallMm: 0, station: null },
  variations: { rows: [], unreferenced: over.unnumbered ?? 0, totalHours: 0 },
  unsigned: { days: over.unsigned ?? [], entryCount: (over.unsigned ?? []).length },
  counts: { daysInRange: 7, daysWithEntries: 5 - (over.missing ?? 0), workingDaysInRange: 5, workingDaysWithEntries: 5 - (over.missing ?? 0), restDaysWithEntries: 0, daysWithoutEntries: over.missing ?? 0, entryCount: 0, peopleCount: 0, pourCount: 0, dayworkCount: 0, delayCount: 0, variationCount: 0 },
}) as unknown as WeeklyData;

test('the company week adds each job up, counts one person on two jobs once, and orders jobs by code', () => {
  const resolve = (n: string) => (n === 'Matt Rodgers' ? 'Matthew Rodgers' : n);
  const c = rollUp('2026-09-21', '2026-09-27', [
    summariseJob(week({ id: 'b', code: 'C010', hours: 50, people: ['Florian'] }), resolve),
    summariseJob(week({ id: 'a', code: 'C001', hours: 281.5, people: ['Matthew Rodgers', 'AJ'], delays: [{ category: 'Weather', minutes: 120 }] }), resolve),
    summariseJob(week({ id: 'c', code: 'C002', hours: 30, people: ['Matt Rodgers'] }), resolve),
  ]);
  assert.deepEqual(c.jobs.map((j) => j.code), ['C001', 'C002', 'C010']);
  assert.equal(c.totals.labourHours, 361.5);
  assert.equal(c.totals.people, 3);
  assert.equal(c.totals.plantHours, 36);
  assert.equal(c.jobs[0].topDelay, 'Weather');
  assert.deepEqual(c.jobs[0].done, ['Trenching — Stage 1']);
});

test('what needs attention: days with no diary, days not signed, unnumbered variations, dayworks without a docket', () => {
  const c = rollUp('2026-09-21', '2026-09-27', [
    summariseJob(week({ id: 'a', code: 'C001', missing: 1, unsigned: ['2026-09-24', '2026-09-25'], unnumbered: 1, docketless: 2 })),
    summariseJob(week({ id: 'b', code: 'C002' })),
  ]);
  assert.deepEqual(c.attention.map((a) => `${a.code}: ${a.text}`), [
    'C001: 1 working day with no diary',
    'C001: 2 days not signed yet',
    'C001: 1 variation with no register number',
    'C001: 2 dayworks without a docket',
  ]);
  assert.equal(c.totals.workingDaysMissing, 1);
  assert.equal(c.totals.unsignedDays, 2);
});

test('a job counts its working days from when it began, and a job not begun is missing nothing', () => {
  assert.equal(weekdaysBetween('2026-09-23', '2026-09-27'), 3);
  const c = rollUp('2026-09-21', '2026-09-27', [
    summariseJob(week({ id: 'a', code: 'C002', missing: 2 }), undefined, '2026-09-23'),
    summariseJob(week({ id: 'b', code: 'C010', missing: 5 }), undefined, null),
    summariseJob(week({ id: 'c', code: 'C001' }), undefined, '2026-08-31'),
  ]);
  const byCode = Object.fromEntries(c.jobs.map((j) => [j.code, j]));
  assert.equal(byCode.C002.workingDays, 3);
  assert.equal(byCode.C002.workingDaysRecorded, 3);
  assert.equal(byCode.C010.notStarted, true);
  assert.equal(byCode.C001.workingDays, 5);
  assert.deepEqual(c.attention, []);
  assert.equal(c.totals.workingDaysMissing, 0);
});
