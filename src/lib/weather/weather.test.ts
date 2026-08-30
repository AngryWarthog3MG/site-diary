import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseObservations } from './parse.ts';
import {
  deriveWeather,
  haversineKm,
  hasObservations,
  inferProductId,
  mergeWeather,
  pickStation,
} from './derive.ts';
import type { DerivedWeather } from './types.ts';

/**
 * The fixture is a real IDW60920 product, trimmed to five stations. Parsing
 * and window handling are tested against what BOM actually sends rather than
 * against a hand-written idea of it.
 */
const snapshot = parseObservations(
  readFileSync('src/lib/weather/fixtures/idw60920-sample.xml', 'utf8'),
  'IDW60920',
);

// The site the seed data uses, in the Perth CBD.
const SITE = { lat: -31.9523, lon: 115.8613 };
const ENTRY_DATE = '2026-08-25';

test('parses stations, coordinates and windowed elements', () => {
  assert.equal(snapshot.productId, 'IDW60920');
  assert.ok(snapshot.issuedAt, 'no issue time');
  assert.equal(snapshot.stations.length, 5);

  const perth = snapshot.stations.find((s) => s.name === 'PERTH METRO');
  assert.ok(perth, 'PERTH METRO missing');
  assert.equal(perth.wmoId, '94608');
  assert.equal(perth.bomId, '009225');
  assert.ok(Math.abs(perth.lat - -31.9192) < 0.001);

  const rain = perth.elements.find((e) => e.type === 'rainfall');
  assert.ok(rain, 'rainfall element missing');
  assert.equal(rain.units, 'mm');
  assert.ok(rain.startLocal?.startsWith('2026-08-25T09:00'), 'rainfall window starts at 9am');
});

test('picks the nearest station to the site', () => {
  const choice = pickStation(snapshot.stations, SITE);
  assert.ok(choice);
  assert.equal(choice.station.name, 'PERTH METRO');
  // Perth Airport is the next closest, ~10 km further east.
  assert.ok(choice.distanceKm < 5, `nearest was ${choice.distanceKm} km away`);
});

test('a pinned station wins over the nearest, by WMO or BOM id', () => {
  const byWmo = pickStation(snapshot.stations, SITE, '94151');
  const byBom = pickStation(snapshot.stations, SITE, '009291');
  // BOM ids carry leading zeros; a supervisor typing one may well drop them.
  const withoutLeadingZeros = pickStation(snapshot.stations, SITE, '9291');

  assert.equal(byWmo?.station.name, 'PERTH AIRPORT');
  assert.equal(byBom?.station.name, 'PERTH AIRPORT');
  assert.equal(withoutLeadingZeros?.station.name, 'PERTH AIRPORT');
});

test('an unknown pinned station falls back to the nearest', () => {
  const choice = pickStation(snapshot.stations, SITE, '99999');
  assert.equal(choice?.station.name, 'PERTH METRO');
});

test('distances are real: Perth to Kununurra is about 2200 km', () => {
  const kununurra = snapshot.stations.find((s) => s.name === 'KUNUNURRA AERO');
  assert.ok(kununurra);
  const km = haversineKm(SITE, kununurra);
  assert.ok(km > 2000 && km < 2500, `got ${Math.round(km)} km`);
});

test('takes the running maximum and rain total for the entry date', () => {
  const choice = pickStation(snapshot.stations, SITE)!;
  const at = new Date('2026-08-25T11:25:00Z'); // 19:25 in Perth

  const weather = deriveWeather(choice, ENTRY_DATE, at);

  assert.equal(weather.rainfall_mm, 0);
  assert.equal(weather.temp_max, 21.1);
  assert.equal(weather.station_id, '94608');
  assert.equal(weather.station_name, 'PERTH METRO');
  assert.ok(weather.observed_from?.startsWith('2026-08-25T06:00'));
  assert.ok(hasObservations(weather));
});

test('the observation window stops at the fetch, not at BOM’s declared end', () => {
  // BOM declares the running maximum's window as 06:00–21:00 regardless of the
  // time. An entry signed at half five must not claim observations up to nine.
  const choice = pickStation(snapshot.stations, SITE)!;
  const at = new Date('2026-08-25T09:31:00Z'); // 17:31 in Perth

  const weather = deriveWeather(choice, ENTRY_DATE, at);

  assert.ok(weather.observed_from?.startsWith('2026-08-25T06:00'));
  assert.ok(
    Date.parse(weather.observed_to!) <= at.getTime(),
    `observed_to ${weather.observed_to} runs past the fetch at ${at.toISOString()}`,
  );
});

test('a window that has genuinely closed is kept as BOM stated it', () => {
  const choice = pickStation(snapshot.stations, SITE)!;
  // Long after the day is over, the declared 21:00 end is the honest one.
  const weather = deriveWeather(choice, ENTRY_DATE, new Date('2026-08-26T04:00:00Z'));
  assert.equal(weather.observed_to, '2026-08-25T21:00:00+08:00');
});

test('will not record tonight’s minimum as today’s', () => {
  // At knock-off, BOM's minimum_air_temperature element covers 18:00 tonight
  // to 09:00 tomorrow. Recording that as the day's minimum would be inventing
  // a number, so the field stays null for the supervisor.
  const choice = pickStation(snapshot.stations, SITE)!;
  const weather = deriveWeather(choice, ENTRY_DATE, new Date('2026-08-25T11:25:00Z'));

  const min = choice.station.elements.find((e) => e.type === 'minimum_air_temperature');
  assert.ok(min, 'fixture has no minimum element to reject');
  assert.ok(min.endLocal?.startsWith('2026-08-26'), 'fixture window is not the coming night');
  assert.equal(weather.temp_min, null);
});

test('records nothing for a day the observation does not cover', () => {
  const choice = pickStation(snapshot.stations, SITE)!;
  const weather = deriveWeather(choice, '2026-08-24', new Date('2026-08-25T11:25:00Z'));

  assert.equal(weather.rainfall_mm, null);
  assert.equal(weather.temp_max, null);
  assert.equal(weather.wind_dir, null);
  assert.equal(hasObservations(weather), false);
  // The station is still identified, so the caller can say why nothing landed.
  assert.equal(weather.station_name, 'PERTH METRO');
});

test('wind is only recorded if the reading was taken on the day', () => {
  const choice = pickStation(snapshot.stations, SITE)!;
  const onDay = deriveWeather(choice, ENTRY_DATE, new Date('2026-08-25T11:25:00Z'));
  assert.equal(onDay.wind_dir, 'NNW');
  assert.equal(onDay.wind_kmh, 7);

  const otherDay = deriveWeather(choice, '2026-08-26', new Date('2026-08-26T01:00:00Z'));
  assert.equal(otherDay.wind_dir, null);
});

// --- merging ---------------------------------------------------------------

const base = (over: Partial<DerivedWeather> = {}): DerivedWeather => ({
  temp_max: null,
  temp_min: null,
  rainfall_mm: null,
  wind_dir: null,
  wind_kmh: null,
  station_id: '94608',
  station_name: 'PERTH METRO',
  station_distance_km: 4.2,
  observed_from: null,
  observed_to: null,
  ...over,
});

test('the morning minimum survives the afternoon refetch', () => {
  // Fetched at smoko: BOM still had last night's completed minimum.
  const morning = base({ temp_min: 9.8, temp_max: 14.2, rainfall_mm: 0.4 });
  // Fetched at knock-off: the minimum element has moved on, so it is null.
  const evening = base({ temp_min: null, temp_max: 21.1, rainfall_mm: 12.6 });

  const merged = mergeWeather(morning, evening);

  assert.equal(merged.temp_min, 9.8, 'the morning minimum was lost');
  assert.equal(merged.temp_max, 21.1, 'the running maximum should rise');
  assert.equal(merged.rainfall_mm, 12.6, 'rain since 9am is monotonic');
});

test('merging never walks a maximum or a rain total backwards', () => {
  const merged = mergeWeather(
    base({ temp_max: 21.1, rainfall_mm: 12.6 }),
    base({ temp_max: 18.0, rainfall_mm: 0 }),
  );
  assert.equal(merged.temp_max, 21.1);
  assert.equal(merged.rainfall_mm, 12.6);
});

test('wind takes the newer reading', () => {
  const merged = mergeWeather(
    base({ wind_dir: 'NNW', wind_kmh: 7 }),
    base({ wind_dir: 'SW', wind_kmh: 24 }),
  );
  assert.equal(merged.wind_dir, 'SW');
  assert.equal(merged.wind_kmh, 24);
});

test('a change of station replaces rather than merges', () => {
  // A maximum from one gauge and a rain total from another is not an
  // observation of anywhere.
  const merged = mergeWeather(
    base({ temp_max: 30, rainfall_mm: 40 }),
    base({ station_id: '94610', station_name: 'PERTH AIRPORT', temp_max: 18 }),
  );
  assert.equal(merged.station_id, '94610');
  assert.equal(merged.temp_max, 18);
  assert.equal(merged.rainfall_mm, null);
});

test('merging widens the observation window', () => {
  const merged = mergeWeather(
    base({ observed_from: '2026-08-25T09:00:00+08:00', observed_to: '2026-08-25T11:00:00+08:00' }),
    base({ observed_from: '2026-08-25T06:00:00+08:00', observed_to: '2026-08-25T19:22:00+08:00' }),
  );
  assert.equal(merged.observed_from, '2026-08-25T06:00:00+08:00');
  assert.equal(merged.observed_to, '2026-08-25T19:22:00+08:00');
});

// --- product inference -----------------------------------------------------

test('infers the state product from site coordinates', () => {
  assert.equal(inferProductId(-31.95, 115.86), 'IDW60920'); // Perth
  assert.equal(inferProductId(-33.87, 151.21), 'IDN60920'); // Sydney
  assert.equal(inferProductId(-37.81, 144.96), 'IDV60920'); // Melbourne
  assert.equal(inferProductId(-27.47, 153.03), 'IDQ60920'); // Brisbane
  assert.equal(inferProductId(-34.93, 138.6), 'IDS60920'); // Adelaide
  assert.equal(inferProductId(-42.88, 147.33), 'IDT60920'); // Hobart
  assert.equal(inferProductId(-12.46, 130.84), 'IDD60920'); // Darwin
  assert.equal(inferProductId(-35.28, 149.13), 'IDN60920'); // Canberra, in the NSW product
});

test('bad coordinates infer nothing rather than guessing', () => {
  assert.equal(inferProductId(Number.NaN, 115), null);
  assert.equal(inferProductId(-31, Number.POSITIVE_INFINITY), null);
});

test('a wind-only mast never beats a reporting station — the Inner Dolphin Pylon rule', () => {
  // A pylon 1 km from site that reports wind and nothing else, exactly like
  // the one that put a dash-only weather row on a signed docket.
  const pylon = {
    wmoId: '99901',
    bomId: null,
    name: 'INNER DOLPHIN PYLON',
    lat: SITE.lat + 0.009,
    lon: SITE.lon,
    timezone: null,
    observedAt: null,
    observedLocal: '2026-08-25T15:00:00+08:00',
    elements: [
      { type: 'wind_dir', value: null, text: 'S', units: null, startLocal: null, endLocal: null },
      { type: 'wind_spd_kmh', value: 15, text: null, units: 'km/h', startLocal: null, endLocal: null },
    ],
  } as (typeof snapshot.stations)[number];

  const choice = pickStation([pylon, ...snapshot.stations], SITE);
  assert.equal(choice?.station.name, 'PERTH METRO', 'skips the nearer wind-only mast');

  // But when nothing in the product reports weather, nearest still wins, so
  // the resolver downstream can refuse with a name attached.
  const bare = pickStation([pylon], SITE);
  assert.equal(bare?.station.name, 'INNER DOLPHIN PYLON');

  // And an explicit pin on the pylon is honoured — a human choice outranks the rule.
  const pinned = pickStation([pylon, ...snapshot.stations], SITE, '99901');
  assert.equal(pinned?.station.name, 'INNER DOLPHIN PYLON');
});
