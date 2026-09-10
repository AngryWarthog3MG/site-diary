import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketVerdict, expiring, normaliseName } from './tickets.ts';

const TODAY = '2026-09-10';

test('a current ticket of the right kind covers the machine', () => {
  const v = ticketVerdict('excavator', [{ ticket_type: 'excavator', expires_on: '2027-01-01', active: true }], TODAY);
  assert.deepEqual(v, { kind: 'covered', by: 'excavator', expires: '2027-01-01' });
  assert.equal(ticketVerdict('excavator', [{ ticket_type: 'excavator', expires_on: null, active: true }], TODAY).kind, 'covered');
});

test('an expired ticket does not; the wrong ticket does not; nothing recorded is a warning, not a refusal', () => {
  assert.equal(ticketVerdict('excavator', [{ ticket_type: 'excavator', expires_on: '2026-09-09', active: true }], TODAY).kind, 'expired');
  assert.equal(ticketVerdict('excavator', [{ ticket_type: 'white_card', expires_on: null, active: true }], TODAY).kind, 'missing');
  assert.equal(ticketVerdict('excavator', [], TODAY).kind, 'none_recorded');
  assert.equal(ticketVerdict('excavator', [{ ticket_type: 'excavator', expires_on: null, active: false }], TODAY).kind, 'none_recorded');
});

test('any one of several licences covers a truck; small plant needs nothing', () => {
  assert.equal(ticketVerdict('vac_truck', [{ ticket_type: 'hr_licence', expires_on: null, active: true }], TODAY).kind, 'covered');
  assert.equal(ticketVerdict('vac_truck', [{ ticket_type: 'c_licence', expires_on: null, active: true }], TODAY).kind, 'missing');
  assert.equal(ticketVerdict('small_plant', [], TODAY).kind, 'not_needed');
});

test('the digest sees what lapsed and what is about to', () => {
  const { expired, soon } = expiring([
    { person_name: 'A', ticket_type: 'first_aid', expires_on: '2026-09-01', active: true },
    { person_name: 'B', ticket_type: 'ewp', expires_on: '2026-09-30', active: true },
    { person_name: 'C', ticket_type: 'ewp', expires_on: '2027-09-30', active: true },
  ], TODAY);
  assert.deepEqual(expired.map((t) => t.person_name), ['A']);
  assert.deepEqual(soon.map((t) => t.person_name), ['B']);
});

test('names match as people type them', () => {
  assert.equal(normaliseName('  Danny   Rowe '), 'danny rowe');
});
