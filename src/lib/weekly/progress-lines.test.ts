import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressSeries, MAX_SERIES } from './progress-series.ts';

type Row = { date: string; area: string | null; percent_complete: number | null };

const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];

test('one series per area, only the days a figure was given', () => {
  const s = buildProgressSeries(
    [
      { date: '2026-08-31', area: 'Busport', percent_complete: 40 },
      { date: '2026-09-02', area: 'Busport', percent_complete: 70 },
      { date: '2026-09-01', area: 'Old Brand Drive', percent_complete: 50 },
      { date: '2026-09-03', area: 'Busport', percent_complete: null }, // said nothing about progress
    ],
    days,
  );
  assert.deepEqual(s.map((x) => x.area), ['Busport', 'Old Brand Drive']);
  assert.deepEqual(s[0].points.map((p) => p.date), ['2026-08-31', '2026-09-02']);
  assert.equal(s[0].latest, 70);
});

test('two items on one area in one day: the higher figure is the day', () => {
  const s = buildProgressSeries(
    [
      { date: '2026-09-01', area: 'Busport', percent_complete: 60 },
      { date: '2026-09-01', area: 'Busport', percent_complete: 45 },
    ],
    days,
  );
  assert.deepEqual(s[0].points, [{ date: '2026-09-01', percent: 60 }]);
});

test('rows with no area or no percentage draw nothing, and the chart caps its lines', () => {
  const rows: Row[] = Array.from({ length: 8 }, (_, i) => ({ date: '2026-09-01', area: `Area ${i}`, percent_complete: 10 * i }));
  rows.push({ date: '2026-09-01', area: null, percent_complete: 99 });
  const s = buildProgressSeries(rows, days);
  assert.equal(s.length, MAX_SERIES);
  assert.ok(s.every((x) => x.area.startsWith('Area')));
});

test('one area said three ways is one line, under its latest spelling', () => {
  const s = buildProgressSeries(
    [
      { date: '2026-08-31', area: 'Busport', percent_complete: 40 },
      { date: '2026-09-02', area: 'Bus port', percent_complete: 70 },
      { date: '2026-09-04', area: 'Bus Port', percent_complete: 100 },
      // Different words are different places until a person says otherwise.
      { date: '2026-09-01', area: 'Old Brand Road', percent_complete: 60 },
      { date: '2026-09-03', area: 'Old Brand Drive', percent_complete: 50 },
    ],
    days,
  );
  assert.deepEqual(s.map((x) => x.area), ['Bus Port', 'Old Brand Drive', 'Old Brand Road']);
  assert.deepEqual(s[0].points.map((p) => p.percent), [40, 70, 100]);
});
