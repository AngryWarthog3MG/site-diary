import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeField, appendDictation } from './dictation-merge.ts';

test('an empty field takes the dictation; a filled one keeps its words and gains a line', () => {
  assert.equal(mergeField('', 'Mulching to the Busport beds'), 'Mulching to the Busport beds');
  assert.equal(mergeField('Potholing near the comms pit', 'Mulching to the Busport beds'),
    'Potholing near the comms pit\nMulching to the Busport beds');
});

test('nothing is replaced or duplicated, and null adds nothing', () => {
  assert.equal(mergeField('Typed by hand', null), 'Typed by hand');
  assert.equal(mergeField('Typed by hand', '   '), 'Typed by hand');
  assert.equal(mergeField('- Live pit: hand dig only', '- Live pit: hand dig only'), '- Live pit: hand dig only');
});

test('the kept transcript grows in order', () => {
  assert.equal(appendDictation(null, ' First go. '), 'First go.');
  assert.equal(appendDictation('First go.', 'Second go.'), 'First go.\n\nSecond go.');
  assert.equal(appendDictation('First go.', ''), 'First go.');
});
