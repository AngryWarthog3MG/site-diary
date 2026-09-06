import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTerms, stemLoosely } from './terms.ts';

test('search terms drop scaffolding and keep codes and materials', () => {
  assert.deepEqual(searchTerms('what soil amount do I need in the GA01 area'), ['soil', 'amount', 'GA01']);
  assert.deepEqual(searchTerms('Placing topsoil in the Busport area'), ['Placing', 'topsoil', 'Busport']);
  assert.deepEqual(searchTerms('Vac excavate for irrigation lines'), ['Vac', 'excavate', 'irrigation', 'lines']);
  assert.deepEqual(searchTerms('the the the'), []);
});

test('terms are capped and de-duplicated', () => {
  assert.equal(searchTerms('one two three four five six seven eight nine ten').length, 8);
  assert.deepEqual(searchTerms('Mulch mulch MULCH'), ['Mulch']);
  assert.equal(stemLoosely('beds'), 'beds'.length > 4 ? 'bed' : 'beds');
  assert.equal(stemLoosely('trenches'), 'trench');
});
