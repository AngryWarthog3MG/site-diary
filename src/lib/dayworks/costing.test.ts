import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryAllocations, costLine, fmtAmount, machinesInPeriod, peopleInPeriod, plantRateIndex, rateIndex, readPlantRows, totalCosts, whyNoAmount } from './costing.ts';

const rates = rateIndex([
  { person_name: 'Evan Burke', rate: 105 },
  { person_name: 'Matthew Rodgers', rate: 140 },
  { person_name: 'Marcus Hayden', rate: 105 },
  { person_name: 'Old Hand', rate: 90, active: false },
]);
const plantRates = plantRateIndex([
  { plant_id: 'vac', label: 'Vac Trailer', rate: 320 },
  { plant_id: null, label: '1.8t Excavator', rate: 150 },
]);
const resolve = (n: string) => (n.toLowerCase() === 'matty rogers' ? 'Matthew Rodgers' : n);

test('each person is hours × their rate, and the item is their sum', () => {
  const c = costLine({ rows: [{ person_name: 'Evan Burke', hours: 6.5 }, { person_name: 'Matty Rogers', hours: 6.5 }] }, resolve, rates);
  assert.deepEqual(c.people.map((p) => [p.person, p.rate, p.amount]), [['Evan Burke', 105, 682.5], ['Matthew Rodgers', 140, 910]]);
  assert.equal(c.amount, 1592.5);
  assert.equal(c.labourFrom, 'record');
  assert.deepEqual(c.missingRate, []);
  assert.equal(c.noRows, false);
});

test('a name with no rate leaves the item blank and names them — never a nought', () => {
  const c = costLine({ rows: [{ person_name: 'Evan Burke', hours: 8 }, { person_name: 'Kel Brady', hours: 8 }] }, resolve, rates);
  assert.equal(c.people[1].amount, null);
  assert.equal(c.amount, null);
  assert.deepEqual(c.missingRate, ['Kel Brady']);
  assert.equal(whyNoAmount(c), 'No rate: Kel Brady');
});

test('a person without hours leaves the item blank — the total is never shared out', () => {
  const c = costLine({ rows: [{ person_name: 'Evan Burke', hours: null }, { person_name: 'Marcus Hayden', hours: 4 }] }, resolve, rates);
  assert.equal(c.people[0].amount, null);
  assert.equal(c.people[1].amount, 420);
  assert.equal(c.amount, null);
  assert.deepEqual(c.missingHours, ['Evan Burke']);
});

test('a retired rate is no rate; case and spacing do not matter', () => {
  assert.equal(rates('old hand'), null);
  assert.equal(rates('  evan   BURKE '), 105);
});

test('an item with nobody on the row and nobody allocated cannot be costed and says so', () => {
  const c = costLine({ rows: [] }, resolve, rates);
  assert.equal(c.noRows, true);
  assert.equal(c.labourFrom, 'none');
  assert.equal(c.amount, null);
  assert.equal(whyNoAmount(c), 'People not on the row');
});

test('the office allocation supplies the people only where the row names nobody — the record wins', () => {
  const allocated = [{ person_name: 'Marcus Hayden', hours: 10 }, { person_name: 'Evan Burke', hours: 10 }];
  const fromAllocation = costLine({ rows: [], allocatedLabour: allocated }, resolve, rates);
  assert.equal(fromAllocation.labourFrom, 'allocation');
  assert.equal(fromAllocation.amount, 2100);
  const fromRecord = costLine({ rows: [{ person_name: 'Evan Burke', hours: 2 }], allocatedLabour: allocated }, resolve, rates);
  assert.equal(fromRecord.labourFrom, 'record');
  assert.equal(fromRecord.amount, 210);
});

test('machines cost at the rate card: by the machine itself, else by its name', () => {
  const c = costLine({ rows: [{ person_name: 'Evan Burke', hours: 4 }], plant: [{ plant_id: 'vac', name: 'Vac Trailer T-1', hours: 4 }, { plant_id: null, name: '1.8t excavator', hours: 4 }] }, resolve, rates, plantRates);
  assert.deepEqual(c.machines.map((m) => [m.rate, m.amount]), [[320, 1280], [150, 600]]);
  assert.equal(c.labourAmount, 420);
  assert.equal(c.plantAmount, 1880);
  assert.equal(c.amount, 2300);
});

test('a machine without a rate or hours leaves the item blank and names it', () => {
  const noRate = costLine({ rows: [{ person_name: 'Evan Burke', hours: 4 }], plant: [{ plant_id: null, name: 'Roller', hours: 4 }] }, resolve, rates, plantRates);
  assert.equal(noRate.amount, null);
  assert.equal(noRate.labourAmount, 420);
  assert.equal(whyNoAmount(noRate), 'No plant rate: Roller');
  const noHours = costLine({ rows: [{ person_name: 'Evan Burke', hours: 4 }], plant: [{ plant_id: 'vac', name: 'Vac Trailer', hours: null }] }, resolve, rates, plantRates);
  assert.equal(noHours.amount, null);
  assert.equal(whyNoAmount(noHours), 'Plant hours missing: Vac Trailer');
});

test('plant recorded in words with no machine picked is flagged, and the amount is labour alone', () => {
  const c = costLine({ rows: [{ person_name: 'Evan Burke', hours: 4 }], plantText: 'Vac Trailer, 1.8t Excavator' }, resolve, rates, plantRates);
  assert.equal(c.plantNotCosted, true);
  assert.equal(c.amount, 420);
  assert.equal(c.plantAmount, null);
  const t = totalCosts([c]);
  assert.equal(t.plantNotCosted, 1);
});

test('totals add only the items with an amount and count the rest', () => {
  const a = costLine({ rows: [{ person_name: 'Evan Burke', hours: 2 }] }, resolve, rates);
  const b = costLine({ rows: [{ person_name: 'Nobody Known', hours: 2 }] }, resolve, rates);
  const t = totalCosts([a, b, costLine({ rows: [] }, resolve, rates)]);
  assert.deepEqual(t, { amount: 210, costed: 1, notCosted: 2, plantNotCosted: 0, excluded: 0 });
});

test('an item left out of the claim is costed for the record and carried by no total or list', () => {
  const out = costLine({ rows: [{ person_name: 'Evan Burke', hours: 2 }], excluded: true, excludedReason: ' Not ours to claim ' }, resolve, rates);
  assert.equal(out.amount, 210);
  assert.equal(out.excluded, true);
  assert.equal(out.excludedReason, 'Not ours to claim');
  assert.equal(whyNoAmount(out), 'Left out of the claim');
  const t = totalCosts([out, costLine({ rows: [{ person_name: 'Evan Burke', hours: 1 }] }, resolve, rates)]);
  assert.deepEqual(t, { amount: 105, costed: 1, notCosted: 0, plantNotCosted: 0, excluded: 1 });
  assert.deepEqual(peopleInPeriod([out]), []);
});

test('people in the period are listed once each with their hours, rate and item count', () => {
  const costs = [
    costLine({ rows: [{ person_name: 'Matty Rogers', hours: 6.5 }, { person_name: 'Evan Burke', hours: 6.5 }] }, resolve, rates),
    costLine({ rows: [{ person_name: 'Matthew Rodgers', hours: null }, { person_name: 'Kel Brady', hours: 3 }] }, resolve, rates),
  ];
  const people = peopleInPeriod(costs);
  assert.deepEqual(people.map((p) => [p.person, p.rate, p.hours, p.hoursNotRecorded, p.items]), [
    ['Evan Burke', 105, 6.5, 0, 1],
    ['Kel Brady', null, 3, 0, 1],
    ['Matthew Rodgers', 140, 6.5, 1, 2],
  ]);
});

test('machines in the period are listed once each, by the register machine else by name', () => {
  const costs = [
    costLine({ rows: [{ person_name: 'Evan Burke', hours: 4 }], plant: [{ plant_id: 'vac', name: 'Vac Trailer', hours: 4 }, { plant_id: null, name: 'Roller', hours: 2 }] }, resolve, rates, plantRates),
    costLine({ rows: [{ person_name: 'Evan Burke', hours: 4 }], plant: [{ plant_id: 'vac', name: 'Vac Trailer T-1', hours: null }] }, resolve, rates, plantRates),
  ];
  assert.deepEqual(machinesInPeriod(costs).map((m) => [m.name, m.rate, m.hours, m.hoursNotRecorded, m.items]), [
    ['Roller', null, 2, 0, 1],
    ['Vac Trailer', 320, 4, 1, 2],
  ]);
});

test('plant rows read back without trusting the shape', () => {
  assert.deepEqual(readPlantRows([{ plant_id: 'x', name: ' Vac ', hours: '4' }, { name: '' }, null, { plant_id: '', name: 'Roller' }]), [
    { plant_id: 'x', name: 'Vac', hours: 4 },
    { plant_id: null, name: 'Roller', hours: null },
  ]);
});

test('amounts print to the cent only when there are cents, and a blank as a dash', () => {
  assert.equal(fmtAmount(910), '$910');
  assert.equal(fmtAmount(682.5), '$682.50');
  assert.equal(fmtAmount(1592.5), '$1,592.50');
  assert.equal(fmtAmount(null), '—');
});

test('an allocation left on a superseded version of the day carries to the same works, once, never when ambiguous', () => {
  const lines = [
    { date: '2026-09-21', works: 'Ivac truck plus driver', dayworkId: 'new-1' },
    { date: '2026-09-21', works: 'Backfill', dayworkId: 'new-2' },
    { date: '2026-09-22', works: 'Kerb', dayworkId: 'new-3' },
  ];
  const own = new Set(['new-3']);
  const orphans = [
    { date: '2026-09-21', works: '  ivac truck plus driver ', allocation: 'old-ivac' },
    { date: '2026-09-21', works: 'Backfill', allocation: 'old-a' },
    { date: '2026-09-21', works: 'Backfill', allocation: 'old-b' },
    { date: '2026-09-22', works: 'Kerb', allocation: 'old-kerb' },
  ];
  const carried = carryAllocations(lines, own, orphans);
  assert.deepEqual([...carried.entries()], [['new-1', 'old-ivac']]);
});

test('zero hours is a positive assertion and costs nothing, counted as costed; amounts print as expected', () => {
  const c = costLine({ rows: [{ person_name: 'Evan Burke', hours: 0 }] }, resolve, rates);
  assert.equal(c.amount, 0);
  assert.deepEqual(totalCosts([c]), { amount: 0, costed: 1, notCosted: 0, plantNotCosted: 0, excluded: 0 });
});
