import test from 'node:test';
import assert from 'node:assert/strict';
import {
  datesInRange,
  aggregateLabour,
  aggregatePlant,
  aggregatePours,
  aggregateQuantities,
  aggregateDelays,
  aggregateVariations,
} from './load.ts';

test('datesInRange covers the week inclusive', () => {
  const days = datesInRange('2026-08-24', '2026-08-30');
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-08-24');
  assert.equal(days[6], '2026-08-30');
});

test('datesInRange rejects a backwards range', () => {
  assert.deepEqual(datesInRange('2026-08-30', '2026-08-24'), []);
});

test('labour matrix sums per person per day, with overtime folded into the day cell', () => {
  const days = datesInRange('2026-08-24', '2026-08-25');
  const out = aggregateLabour(
    [
      { entry_date: '2026-08-24', person_name: 'Matty', role: 'supervisor', hours: 8, overtime_hours: 1 },
      { entry_date: '2026-08-25', person_name: 'Matty', role: 'supervisor', hours: 9, overtime_hours: null },
      { entry_date: '2026-08-24', person_name: 'Hamish', role: 'labourer', hours: 8, overtime_hours: null },
    ],
    days,
  );
  const matty = out.people.find((p) => p.name === 'Matty');
  assert.ok(matty);
  assert.equal(matty.byDay['2026-08-24'], 9);
  assert.equal(matty.total, 18);
  assert.equal(matty.overtime, 1);
  assert.equal(out.dayTotals['2026-08-24'], 17);
  assert.equal(out.grandTotal, 26);
});

test('plant groups by item and supplier and carries idle time', () => {
  const out = aggregatePlant([
    { item: '20t excavator', supplier: 'Coates', hire_type: 'wet', hours: 8, idle_hours: 0 },
    { item: '20t excavator', supplier: 'Coates', hire_type: 'wet', hours: 6, idle_hours: 2 },
    { item: 'Franna', supplier: null, hire_type: null, hours: 4, idle_hours: null },
  ]);
  assert.equal(out.rows.length, 2);
  const exc = out.rows.find((r) => r.item === '20t excavator');
  assert.equal(exc?.hours, 14);
  assert.equal(exc?.idle, 2);
  assert.equal(out.totalHours, 18);
  assert.equal(out.totalIdle, 2);
});

test('pours run a cumulative total in date order', () => {
  const out = aggregatePours([
    { entry_date: '2026-08-26', entry_no: 'KBL-2026-08-26', location: 'Pier 3', volume_m3: 12.5 },
    { entry_date: '2026-08-24', entry_no: 'KBL-2026-08-24', location: 'Pier 2', volume_m3: 10 },
    { entry_date: '2026-08-27', entry_no: 'KBL-2026-08-27', location: 'Pier 4', volume_m3: null },
  ]);
  assert.deepEqual(
    out.rows.map((r) => r.cumulative),
    [10, 22.5, 22.5],
  );
  assert.equal(out.totalVolume, 22.5);
});

test('quantity running totals never cross item types or units', () => {
  const out = aggregateQuantities([
    { item_type: 'pipe', unit: 'm', entry_date: '2026-08-24', quantity: 40 },
    { item_type: 'pipe', unit: 'm', entry_date: '2026-08-25', quantity: 20 },
    { item_type: 'pipe', unit: 'mm', entry_date: '2026-08-25', quantity: 160 },
    { item_type: 'steel', unit: 't', entry_date: '2026-08-24', quantity: 3 },
  ]);
  const metres = out.rows.filter((r) => r.item_type === 'pipe' && r.unit === 'm');
  assert.deepEqual(
    metres.map((r) => r.running),
    [40, 60],
  );
  assert.equal(out.rows.find((r) => r.unit === 'mm')?.running, 160);
  assert.equal(out.rows.find((r) => r.item_type === 'steel')?.running, 3);
});

test('delays total by category and convert to hours', () => {
  const out = aggregateDelays([
    { entry_date: '2026-08-24', cause: 'Rain', category: 'weather', duration_mins: 120 },
    { entry_date: '2026-08-26', cause: 'Rain again', category: 'weather', duration_mins: 60 },
    { entry_date: '2026-08-25', cause: 'Waiting on concrete', category: 'supply', duration_mins: 45 },
    { entry_date: '2026-08-25', cause: 'Unknown length', category: 'supply', duration_mins: null },
  ]);
  assert.equal(out.totalMinutes, 225);
  assert.equal(out.totalHours, 3.75);
  assert.deepEqual(out.byCategory[0], { category: 'weather', minutes: 180, hours: 3 });
});

test('variations flag missing VR references', () => {
  const out = aggregateVariations([
    { entry_date: '2026-08-24', entry_no: 'A', description: 'Extra footing', vr_ref: 'VR-014' },
    { entry_date: '2026-08-25', entry_no: 'B', description: 'Rock breakout', vr_ref: '  ' },
  ]);
  assert.equal(out.unreferenced, 1);
  assert.equal(out.rows[0].referenced, true);
  assert.equal(out.rows[1].vr_ref, null);
});

test('plant is one line per machine, however the days labelled it', () => {
  // The bug this pins: the same excavator appeared three times in a weekly
  // — once as "1.8 kilometer excavator", once with hire "dry", once with
  // hire blank — and read as three machines at 8, 16 and 16 hours.
  const out = aggregatePlant([
    { item: '1.8t excavator', supplier: 'KBS', hire_type: null, hours: 8, idle_hours: null },
    { item: '1.8t Excavator', supplier: 'KBS', hire_type: 'dry', hours: 8, idle_hours: null },
    { item: '1.8T EXCAVATOR', supplier: null, hire_type: null, hours: 8, idle_hours: null },
    { item: 'Vac Trailer', supplier: 'MINIQUIP', hire_type: 'wet', hours: 8, idle_hours: null },
  ]);
  assert.equal(out.rows.length, 2);
  const exc = out.rows.find((r) => r.item.toLowerCase().startsWith('1.8t'));
  assert.equal(exc?.hours, 24);
  // The most recent day's spelling, and the filled-in labels from whichever day had them.
  assert.equal(exc?.item, '1.8T EXCAVATOR');
  assert.equal(exc?.supplier, 'KBS');
  assert.equal(exc?.hire_type, 'dry');
});
