import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trenchNeedsControl, trenchProblem, servicesInfoCurrency, withoutWhiteCard } from './model.ts';

test('a trench needs a control from 1.5 m, and an unknown depth is not assumed deep', () => {
  assert.equal(trenchNeedsControl(1.49), false);
  assert.equal(trenchNeedsControl(1.5), true);
  assert.equal(trenchNeedsControl(null), false);
});

test('reg. 306 is satisfied by a control at depth, and engineer advice must carry its reference', () => {
  assert.match(trenchProblem(2.1, null, null) ?? '', /reg\. 306/);
  assert.equal(trenchProblem(2.1, 'shoring', null), null);
  assert.equal(trenchProblem(0.8, null, null), null);
  assert.match(trenchProblem(2.1, 'engineer_advice', '  ') ?? '', /written advice/);
  assert.equal(trenchProblem(2.1, 'engineer_advice', 'GEO-2291 letter 12/09'), null);
});

test('services information is current by the date given, and no date is not treated as current or expired', () => {
  assert.equal(servicesInfoCurrency('2026-09-30', '2026-09-16'), 'current');
  assert.equal(servicesInfoCurrency('2026-09-15', '2026-09-16'), 'expired');
  assert.equal(servicesInfoCurrency(null, '2026-09-16'), 'no_expiry_stated');
});

test('the crew without a white card: names matched loosely, retired and expired cards do not count, duplicates once', () => {
  const tickets = [
    { person_name: 'Evan Burke', ticket_type: 'white_card', active: true, expires_on: null },
    { person_name: 'marcus  hayden', ticket_type: 'white_card', active: true, expires_on: null },
    { person_name: 'Hamish Hayden', ticket_type: 'white_card', active: false, expires_on: null },
    { person_name: 'AJ', ticket_type: 'excavator', active: true, expires_on: null },
    { person_name: 'Old Timer', ticket_type: 'white_card', active: true, expires_on: '2020-01-01' },
  ];
  const crew = ['Evan Burke', 'Marcus Hayden', 'Hamish Hayden', 'AJ', 'Old Timer', 'AJ '];
  assert.deepEqual(withoutWhiteCard(crew, tickets, '2026-09-16'), ['Hamish Hayden', 'AJ', 'Old Timer']);
});
