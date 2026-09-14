import test from 'node:test';
import assert from 'node:assert/strict';
import { compliance, normaliseCompany } from './model.ts';

const today = '2026-09-14';
test('a company with nothing recorded is not compliant, and says so', () => {
  assert.equal(compliance([], today).verdict, 'none_recorded');
});
test('lapsed beats missing beats expiring beats compliant', () => {
  const pl = { kind: 'public_liability' as const, expires_on: '2027-01-01', active: true };
  const wc = { kind: 'workers_comp' as const, expires_on: '2026-09-20', active: true };
  const swms = { kind: 'swms' as const, expires_on: null, active: true };
  assert.equal(compliance([pl, wc, swms], today).verdict, 'expiring');
  assert.deepEqual(compliance([pl, wc, swms], today).expiring, [{ kind: 'workers_comp', expires_on: '2026-09-20' }]);
  assert.equal(compliance([pl, swms], today).verdict, 'missing');
  assert.equal(compliance([pl, { ...wc, expires_on: '2026-09-01' }, swms], today).verdict, 'lapsed');
  assert.equal(compliance([pl, { ...wc, expires_on: '2027-09-01' }, swms], today).verdict, 'compliant');
});
test('a retired document does not count, and the longest-lasting one is judged', () => {
  const old = { kind: 'public_liability' as const, expires_on: '2026-01-01', active: true };
  const renewed = { kind: 'public_liability' as const, expires_on: '2027-01-01', active: true };
  const wc = { kind: 'workers_comp' as const, expires_on: '2027-06-01', active: true };
  const r = compliance([old, renewed, wc, { kind: 'swms', expires_on: null, active: true }], today);
  assert.equal(r.verdict, 'compliant');
  assert.equal(compliance([{ ...renewed, active: false }, wc, { kind: 'swms', expires_on: null, active: true }], today).verdict, 'missing');
});
test('an insurance with no expiry recorded is missing, not forever', () => {
  const r = compliance([{ kind: 'public_liability', expires_on: null, active: true }, { kind: 'workers_comp', expires_on: '2027-01-01', active: true }, { kind: 'swms', expires_on: null, active: true }], today);
  assert.equal(r.verdict, 'missing');
  assert.deepEqual(r.missing, ['public_liability']);
});
test('company names match however the suffix was typed', () => {
  assert.equal(normaliseCompany('Whitely Plumbing Pty Ltd'), normaliseCompany('whitely   plumbing'));
  assert.equal(normaliseCompany('ACME P/L.'), 'acme');
});
