import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyForDay,
  monthsCovering,
  nextDay,
  parseDailyClimate,
  stateFolder,
  stationSlug,
} from './daily-parse.ts';

// Trimmed from the real perth_metro-202609.csv as issued 05/09/2026.
const CSV = `'IDCKWCDE11,,,,,,,,,,
Australian Government Bureau of Meteorology,,,,,,,,,,
South Australia,,,,,,,,,,

Daily Evapotranspiration for PERTH METRO Western Australia for September 2026,,,,,,,,,,
Issued at 06:32 GMT on Saturday 05 September 2026,,,,,,,,,,

,,Evapo-,,Pan,,,Maximum,Minimum,Average,
,,Transpiration,Rain,Evaporation,Maximum,Minimum,Relative,Relative,10m Wind,Solar
Station Name,Date,0000-2400,0900-0900,0900-0900,Temperature,Temperature,Humidity,Humidity,Speed,Radiation
PERTH METRO,01/09/2026,2.5,2.6, ,19.2,8.3,99,41,1.81,15.39
PERTH METRO,02/09/2026,2.2,0.0, ,19.2,8.5,99,51,1.65,13.42
PERTH METRO,03/09/2026,2.2,1.6, ,19.2,13.1,99,59,2.08,12.96
PERTH METRO,04/09/2026,3.0,3.0, ,19.5, ,92,49,3.70,15.78
Totals:,,18.3,7.2, ,,,,,,
`;

test('parses the Bureau daily table by header pair, not by position', () => {
  const rows = parseDailyClimate(CSV);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { date: '2026-09-01', tempMax: 19.2, tempMin: 8.3, rainTo9am: 2.6, windAvgKmh: 7 });
  // A blank cell is null, never zero — the Bureau leaves a gap when it has no reading.
  assert.equal(rows[3].tempMin, null);
  assert.equal(rows[3].rainTo9am, 3.0);
});

test('a site day takes max and min from its own row and rain from the next', () => {
  const rows = parseDailyClimate(CSV);
  // 03/09: max/min from 03/09; rain that fell 09:00 03/09 → 09:00 04/09 is on the 04/09 row.
  assert.deepEqual(dailyForDay(rows, '2026-09-03'), { temp_max: 19.2, temp_min: 13.1, rainfall_mm: 3.0, wind_kmh: 7 });
  // 04/09: its own row exists but tomorrow's does not yet, so rain is still unknown, not zero.
  assert.deepEqual(dailyForDay(rows, '2026-09-04'), { temp_max: 19.5, temp_min: null, rainfall_mm: null, wind_kmh: 13 });
  // 31/08: no row of its own, but 01/09's rain column is 31/08's site day.
  assert.deepEqual(dailyForDay(rows, '2026-08-31'), { temp_max: null, temp_min: null, rainfall_mm: 2.6, wind_kmh: null });
  assert.equal(dailyForDay(rows, '2026-09-20'), null);
});

test('folder and slug follow the Bureau naming', () => {
  assert.equal(stateFolder('IDW60920'), 'wa');
  assert.equal(stateFolder('IDN60920'), 'nsw');
  assert.equal(stateFolder('IDX60920'), null);
  assert.equal(stationSlug('PERTH METRO'), 'perth_metro');
  assert.equal(stationSlug('Perth Airport'), 'perth_airport');
  assert.equal(stationSlug('KOOLAN ISLAND (KOOLAN CENTRAL AIRPORT)'), 'koolan_island');
});

test('month files needed cover the range and the day after it (for the rain shift)', () => {
  assert.equal(nextDay('2026-08-31'), '2026-09-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.deepEqual(monthsCovering('2026-08-30', '2026-09-05'), ['202608', '202609']);
  assert.deepEqual(monthsCovering('2026-09-25', '2026-09-30'), ['202609', '202610']);
  assert.deepEqual(monthsCovering('2026-09-02', '2026-09-05'), ['202609']);
});
