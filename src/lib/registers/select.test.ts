import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printHref, readIds, readScope, scopeLine } from './select.ts';

const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-9999-000000000000';

test('ids: uuids only, lower-cased, nothing when nothing was asked', () => {
  assert.equal(readIds(null), null);
  assert.equal(readIds(''), null);
  assert.deepEqual([...readIds(`${A.toUpperCase()}, ${B},nonsense,1 or 1=1`)!], [A, B]);
});

test('scope: a list of ids is a selection whatever else the address says', () => {
  assert.equal(readScope('job', readIds(A)), 'selected');
  assert.equal(readScope('job', null), 'job');
  assert.equal(readScope('anything', null), 'all');
});

test('an extract says it is one; the whole register says whose it is', () => {
  const job = { code: 'C001', name: 'Curtin University' };
  assert.match(scopeLine('selected', 3, 5, job, 'Kooboolong'), /^Extract · 3 of 5 lines/);
  assert.match(scopeLine('job', 2, 5, job, 'Kooboolong'), /Extract · the 2 of 5 lines on C001 Curtin University · not the whole of Kooboolong/);
  assert.equal(scopeLine('all', 5, 5, job, 'Kooboolong'), 'The whole company · 5 lines · printed from C001');
});

test('print addresses', () => {
  assert.equal(printHref('/api/plant/register/pdf', 'p1', { scope: 'all' }), '/api/plant/register/pdf?project=p1');
  assert.equal(printHref('/api/plant/register/pdf', 'p1', { scope: 'job' }), '/api/plant/register/pdf?project=p1&scope=job');
  assert.equal(printHref('/api/chemicals/pdf', 'p1', { ids: [A, B] }), `/api/chemicals/pdf?project=p1&ids=${A},${B}`);
});
