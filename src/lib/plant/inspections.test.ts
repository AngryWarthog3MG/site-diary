import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextInspection, intervalMonths, registrationStatus, mayNotBeUsed, lastInspection, type PlantFacts } from './inspections.ts';

const plant = (o: Partial<PlantFacts> = {}): PlantFacts => ({
  inspection_basis: null, inspection_interval_months: null,
  registration_required: false, registration_no: null, registration_expires_on: null, ...o,
});

test('a machine with no basis set is not scheduled, and nothing is invented for it', () => {
  assert.deepEqual(nextInspection(plant(), []), { state: 'not_scheduled' });
});

test('annual applies only as the chosen basis, and only when no interval is stated', () => {
  assert.equal(intervalMonths(plant({ inspection_basis: 'annual' })), 12);
  assert.equal(intervalMonths(plant({ inspection_basis: 'annual', inspection_interval_months: 6 })), 6);
  // A manufacturer basis with no interval written down has no due date to make up.
  assert.equal(intervalMonths(plant({ inspection_basis: 'manufacturer' })), null);
});

test('a machine with a basis and no inspection on record cannot be shown to have been inspected', () => {
  assert.deepEqual(nextInspection(plant({ inspection_basis: 'manufacturer', inspection_interval_months: 6 }), []), { state: 'never_inspected', due: null });
});

test('the interval counts from the last inspection, and maintenance alone does not reset it', () => {
  const p = plant({ inspection_basis: 'competent_person', inspection_interval_months: 6 });
  const records = [
    { kind: 'inspection' as const, done_on: '2026-02-10', next_due_on: null, outcome: 'pass' as const },
    { kind: 'maintenance' as const, done_on: '2026-08-01', next_due_on: null, outcome: null },
  ];
  assert.equal(lastInspection(records)?.done_on, '2026-02-10');
  assert.deepEqual(nextInspection(p, records), { state: 'scheduled', due: '2026-08-10', from: 'interval' });
});

test('a date the inspector wrote down wins over the interval', () => {
  const p = plant({ inspection_basis: 'manufacturer', inspection_interval_months: 12 });
  const records = [{ kind: 'test' as const, done_on: '2026-03-01', next_due_on: '2026-06-01', outcome: 'pass_with_actions' as const }];
  assert.deepEqual(nextInspection(p, records), { state: 'scheduled', due: '2026-06-01', from: 'inspector' });
});

test('registration is not required unless someone says so — most civil plant is not registrable', () => {
  assert.equal(registrationStatus(plant(), '2026-09-16'), 'not_required');
  assert.equal(mayNotBeUsed('not_required'), false);
});

test('a machine that needs registration may not be used with none recorded or one lapsed', () => {
  const needs = (o: Partial<PlantFacts>) => plant({ registration_required: true, ...o });
  assert.equal(registrationStatus(needs({}), '2026-09-16'), 'missing');
  assert.equal(registrationStatus(needs({ registration_no: '  ' }), '2026-09-16'), 'missing');
  assert.equal(registrationStatus(needs({ registration_no: 'MC-1234', registration_expires_on: '2026-09-15' }), '2026-09-16'), 'expired');
  assert.equal(registrationStatus(needs({ registration_no: 'MC-1234', registration_expires_on: '2026-10-01' }), '2026-09-16'), 'expiring');
  assert.equal(registrationStatus(needs({ registration_no: 'MC-1234', registration_expires_on: '2027-09-16' }), '2026-09-16'), 'current');
  assert.equal(registrationStatus(needs({ registration_no: 'MC-1234' }), '2026-09-16'), 'current');
  assert.equal(mayNotBeUsed('missing'), true);
  assert.equal(mayNotBeUsed('expired'), true);
  assert.equal(mayNotBeUsed('expiring'), false);
});
