import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegisterNumber } from './register-number.ts';

test('a spoken reference that is only a number is the register number', () => {
  for (const said of ['7', 'V7', 'v-007', 'VR 7', 'variation 7', '#7', 'Variation #007']) {
    assert.equal(parseRegisterNumber(said), 7, said);
  }
});

test('anything else stays unpicked', () => {
  for (const said of [null, undefined, '', '   ', 'per PM email', 'VR-014a', '0', '1000', 'v 7 and 8']) {
    assert.equal(parseRegisterNumber(said), null, String(said));
  }
});
