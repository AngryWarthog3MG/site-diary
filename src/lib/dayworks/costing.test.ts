import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costLine, fmtAmount, peopleInPeriod, rateIndex, totalCosts } from './costing.ts';

const rates = rateIndex([
  { person_name: 'Evan Burke', rate: 105 },
  { person_name: 'Matthew Rodgers', rate: 140 },
  { person_name: 'Marcus Hayden', rate: 105 },
  { person_name: 'Old Hand', rate: 90, active: false },
]);
const resolve = (n: string) => (n.toLowerCase() === 'matty rogers' ? 'Matthew Rodgers' : n);

test('each person is hours × their rate, and the item is their sum', () => {
  const c = costLine([{ person_name: 'Evan Burke', hours: 6.5 }, { person_name: 'Matty Rogers', hours: 6.5 }], resolve, rates);
  assert.deepEqual(c.people.map((p) => [p.person, p.rate, p.amount]), [['Evan Burke', 105, 682.5], ['Matthew Rodgers', 140, 910]]);
  assert.equal(c.amount, 1592.5);
  assert.deepEqual(c.missingRate, []);
  assert.equal(c.noRows, false);
});

test('a name with no rate leaves the item blank and names them — never a nought', () => {
  const c = costLine([{ person_name: 'Evan Burke', hours: 8 }, { person_name: 'Kel Brady', hours: 8 }], resolve, rates);
  assert.equal(c.people[1].amount, null);
  assert.equal(c.amount, null);
  assert.deepEqual(c.missingRate, ['Kel Brady']);
});

test('a person without hours leaves the item blank — the total is never shared out', () => {
  const c = costLine([{ person_name: 'Evan Burke', hours: null }, { person_name: 'Marcus Hayden', hours: 4 }], resolve, rates);
  assert.equal(c.people[0].amount, null);
  assert.equal(c.people[1].amount, 420);
  assert.equal(c.amount, null);
  assert.deepEqual(c.missingHours, ['Evan Burke']);
});

test('a retired rate is no rate; case and spacing do not matter', () => {
  assert.equal(rates('old hand'), null);
  assert.equal(rates('  evan   BURKE '), 105);
});

test('an item with no labour rows cannot be costed and says so', () => {
  const c = costLine([], resolve, rates);
  assert.equal(c.noRows, true);
  assert.equal(c.amount, null);
});

test('totals add only the items with an amount and count the rest', () => {
  const a = costLine([{ person_name: 'Evan Burke', hours: 2 }], resolve, rates);
  const b = costLine([{ person_name: 'Nobody Known', hours: 2 }], resolve, rates);
  const t = totalCosts([a, b, costLine([], resolve, rates)]);
  assert.deepEqual(t, { amount: 210, costed: 1, notCosted: 2 });
});

test('people in the period are listed once each with their hours, rate and item count', () => {
  const costs = [
    costLine([{ person_name: 'Matty Rogers', hours: 6.5 }, { person_name: 'Evan Burke', hours: 6.5 }], resolve, rates),
    costLine([{ person_name: 'Matthew Rodgers', hours: null }, { person_name: 'Kel Brady', hours: 3 }], resolve, rates),
  ];
  const people = peopleInPeriod(costs);
  assert.deepEqual(people.map((p) => [p.person, p.rate, p.hours, p.hoursNotRecorded, p.items]), [
    ['Evan Burke', 105, 6.5, 0, 1],
    ['Kel Brady', null, 3, 0, 1],
    ['Matthew Rodgers', 140, 6.5, 1, 2],
  ]);
});

test('amounts print to the cent only when there are cents, and a blank as a dash', () => {
  assert.equal(fmtAmount(910), '$910');
  assert.equal(fmtAmount(682.5), '$682.50');
  assert.equal(fmtAmount(1592.5), '$1,592.50');
  assert.equal(fmtAmount(null), '—');
});
