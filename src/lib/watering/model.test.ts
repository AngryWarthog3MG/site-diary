import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, areaHours, cellState, closeProblems, fmtHours, lineGaps, lineProblems, readAreaNames, readHours, readTemp, readWeek, shownAreas, summariseWeek,
  weekDays, weekOf, weekOver, type WateringArea, type WateringDay, type WateringEntry,
} from './model.ts';
import { wateringRegisterDoc } from '../registers/watering.ts';

const MON = '2026-11-23';
const TODAY = '2026-11-24';
const area = (id: string, name: string, sort_order: number, active = true): WateringArea => ({ id, project_id: 'p1', name, sort_order, active });
const AREAS = [area('a1', 'Old Brand Drive North', 1), area('a2', 'East Gate', 3), area('a3', 'Bus Port', 5), area('a9', 'Old Bed', 9, false)];
const e = (over: Partial<WateringEntry>): WateringEntry => ({ area_id: 'a1', day: MON, method: null, hours: null, supp_method: null, supp_hours: null, notes: null, ...over });
const DAYS: WateringDay[] = [{ day: MON, temp_max: 33.8, recorded_by_name: 'Sam Leading', recorded_at: '2026-11-23T08:10:00Z' }, { day: TODAY, temp_max: null, recorded_by_name: 'Sam Leading', recorded_at: '2026-11-24T07:00:00Z' }];
const ENTRIES = [
  e({ method: 'irrigation', hours: 2, supp_method: 'manual', supp_hours: 0.5 }),
  e({ area_id: 'a2', method: 'soaker', hours: 4.5, notes: 'Sprinkler head broken near the gate.' }),
  e({ day: TODAY, method: 'irrigation', hours: 2.5, supp_method: 'manual', supp_hours: null }),
];

test('a week is Monday to Sunday, and the address never opens one that has not begun', () => {
  assert.equal(weekOf('2026-11-24'), MON);
  assert.equal(weekOf('2026-11-29'), MON);
  assert.equal(weekOf(MON), MON);
  assert.deepEqual(weekDays(MON).slice(-1), ['2026-11-29']);
  assert.equal(readWeek('2026-11-18', TODAY), '2026-11-16');
  assert.equal(readWeek('nonsense', TODAY), MON);
  assert.equal(readWeek('2026-12-07', TODAY), MON);
  assert.equal(weekOver(MON, '2026-11-29'), false);
  assert.equal(weekOver(MON, '2026-11-30'), true);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('hours and temperature as typed: blank is not stated, never a number', () => {
  assert.deepEqual(readHours(''), { value: null, ok: true });
  assert.deepEqual(readHours(' 2.5 '), { value: 2.5, ok: true });
  assert.deepEqual(readHours('0.333'), { value: 0.33, ok: true });
  assert.equal(readHours('0').ok, false);
  assert.equal(readHours('25').ok, false);
  assert.equal(readHours('two').ok, false);
  assert.deepEqual(readTemp('36.14'), { value: 36.1, ok: true });
  assert.deepEqual(readTemp(''), { value: null, ok: true });
  assert.equal(readTemp('75').ok, false);
  assert.equal(fmtHours(0.1 + 0.2), '0.3');
});

test('hours never stand without a method; a method may wait for its hours', () => {
  assert.deepEqual(lineProblems(e({ hours: 2 })), ['Hours need a method beside them.']);
  assert.deepEqual(lineProblems(e({ method: 'irrigation', supp_hours: 1 })), ['Supplementary hours need a method beside them.']);
  assert.deepEqual(lineProblems(e({ method: 'manual', hours: 30 })), ['Hours are over 0 and at most 24.']);
  assert.deepEqual(lineProblems(e({ method: 'manual' })), []);
  assert.deepEqual(lineGaps(e({ method: 'manual' })), ['hours']);
  assert.deepEqual(lineGaps(e({ method: 'irrigation', hours: 2, supp_method: 'soaker' })), ['supp_hours']);
  assert.deepEqual(lineGaps(e({ notes: 'Only a note' })), []);
});

test('nil is not a gap: a recorded day says not watered, an unrecorded day says not recorded', () => {
  assert.equal(cellState(e({ method: 'irrigation', hours: 2 }), true, MON, TODAY), 'watered');
  assert.equal(cellState(e({ supp_method: 'manual' }), false, MON, TODAY), 'watered');
  assert.equal(cellState(null, true, MON, TODAY), 'not_watered');
  assert.equal(cellState(e({ notes: 'Rained all day' }), false, MON, TODAY), 'not_watered');
  assert.equal(cellState(null, false, MON, TODAY), 'not_recorded');
  assert.equal(cellState(null, false, '2026-11-27', TODAY), 'ahead');
});

test('hours add up as recorded; a line with no hours is a gap, not a guess', () => {
  const h = areaHours(ENTRIES.filter((x) => x.area_id === 'a1'));
  assert.deepEqual(h, { main: 4.5, supp: 0.5, total: 5, any: true, gaps: 1 });
  assert.deepEqual(areaHours([]), { main: 0, supp: 0, total: 0, any: false, gaps: 0 });
  const s = summariseWeek(MON, TODAY, ENTRIES, DAYS);
  assert.equal(s.total, 9.5);
  assert.equal(s.supp, 0.5);
  assert.equal(s.gaps, 1);
  assert.equal(s.due, 2);
  assert.equal(s.recorded, 2);
  assert.deepEqual(s.unrecorded, []);
  assert.deepEqual(s.hottest, { day: MON, temp: 33.8 });
  assert.deepEqual(summariseWeek(MON, '2026-11-26', ENTRIES, DAYS).unrecorded, ['2026-11-25', '2026-11-26']);
});

test('a retired area shows only in a week it has a line in', () => {
  assert.deepEqual(shownAreas(AREAS, ENTRIES).map((a) => a.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(shownAreas(AREAS, [e({ area_id: 'a9' })]).map((a) => a.id), ['a1', 'a2', 'a3', 'a9']);
});

test('a week closes once it is over with no hours outstanding', () => {
  const name = (id: string) => AREAS.find((a) => a.id === id)?.name ?? '?';
  assert.deepEqual(closeProblems(MON, TODAY, ENTRIES, name), ['A week is closed once it is over — after its Sunday.', 'Tue 24/11 · Old Brand Drive North supplementary still needs its hours.']);
  assert.deepEqual(closeProblems(MON, '2026-11-30', ENTRIES.slice(0, 2), name), []);
});

test('area names typed one per line: tidied, one of each, none the job has', () => {
  assert.deepEqual(readAreaNames(' East  Gate \n\nbus port\nBrand Drive\nbrand drive', ['Bus Port']), ['East Gate', 'Brand Drive']);
});

test('the printed week says what was recorded and nothing else', () => {
  const doc = wateringRegisterDoc({ monday: MON, today: TODAY, areas: AREAS, entries: ENTRIES, days: DAYS, closed: null });
  const daysSect = doc.sections[0];
  assert.deepEqual(daysSect.columns, ['Day', 'Maximum temperature', 'Recorded by', 'On']);
  assert.deepEqual(daysSect.rows[0].map((c) => c.text), ['Mon 23/11/2026', '33.8 °C', 'Sam Leading', '23/11/2026']);
  assert.deepEqual(daysSect.rows[1][1], { text: 'Not read', tone: 'warn' });
  assert.equal(daysSect.rows.length, 2);
  const grid = doc.sections[1];
  assert.deepEqual(grid.columns, ['Area', 'Mon 23/11', 'Tue 24/11', 'Wed 25/11', 'Thu 26/11', 'Fri 27/11', 'Sat 28/11', 'Sun 29/11', 'Week']);
  assert.equal(grid.rows.length, 3);
  const north = grid.rows[0];
  assert.deepEqual(north[1], { text: 'Irrigation 2 h', sub: 'Supplementary: Manual 0.5 h', tone: 'none' });
  assert.deepEqual(north[2], { text: 'Irrigation 2.5 h', sub: 'Supplementary: Manual · hours not recorded', tone: 'warn' });
  assert.deepEqual(north[8], { text: '5 h', sub: 'incl. 0.5 h supplementary', tone: 'warn' });
  const bus = grid.rows[2];
  assert.equal(bus[0].text, 'Bus Port');
  assert.equal(bus[1].text, 'Not watered');
  assert.equal(bus[3].text, '—');
  assert.equal(bus[8].text, '—');
  assert.deepEqual(doc.sections[2].rows, [[{ text: 'Mon 23/11' }, { text: 'East Gate' }, { text: 'Sprinkler head broken near the gate.' }]]);
  assert.match(doc.summary[0], /open — still being recorded/);
  assert.match(doc.summary[1], /9\.5 hours of watering recorded \(9 h and 0\.5 h supplementary\) · 2 of 2 days recorded · hottest 33\.8 °C on Mon 23\/11/);
  assert.match(doc.summary[2], /1 watering line with no hours recorded/);
  // A day that has come and nobody recorded prints as such — never as "not watered".
  const later = wateringRegisterDoc({ monday: MON, today: '2026-11-26', areas: AREAS, entries: ENTRIES, days: DAYS, closed: null });
  assert.deepEqual(later.sections[1].rows[2][3], { text: 'Not recorded', tone: 'warn' });
  assert.deepEqual(later.sections[0].rows[2].map((c) => c.text), ['Wed 25/11/2026', '—', 'Not recorded', '—']);
  // An empty register prints empty, never an example row.
  assert.deepEqual(wateringRegisterDoc({ monday: MON, today: TODAY, areas: [], entries: [], days: [], closed: null }).sections[1].rows, []);
});
