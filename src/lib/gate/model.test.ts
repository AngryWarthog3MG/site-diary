import test from 'node:test';
import assert from 'node:assert/strict';
import { newGateToken, gateUrl, validateGateSignIn } from './model.ts';

test('a gate code is long, lowercase and unambiguous', () => {
  const t = newGateToken();
  assert.equal(t.length, 20);
  assert.match(t, /^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
  assert.notEqual(newGateToken(), t);
  assert.equal(gateUrl('abc'), 'https://kbsdailydiary.me/gate/abc');
});

test('the gate accepts a real person and refuses the rest', () => {
  const ok = validateGateSignIn({ name: '  Jo   Bloggs ', kind: 'visitor', company: 'ACME', contact: '0400 000 000', acknowledged: true });
  assert.ok(ok.ok && ok.value.name === 'Jo Bloggs' && ok.value.company === 'ACME');
  assert.equal(validateGateSignIn({ name: 'J', kind: 'visitor', acknowledged: true }).ok, false);
  assert.equal(validateGateSignIn({ name: 'Jo Bloggs', kind: 'crew', acknowledged: true }).ok, false);
  assert.equal(validateGateSignIn({ name: 'Jo Bloggs', kind: 'visitor', acknowledged: false }).ok, false);
});
