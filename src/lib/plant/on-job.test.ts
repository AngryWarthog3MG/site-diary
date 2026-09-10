import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hireTypeFromOwnership, asKnownPlant } from './on-job.ts';

test('ownership maps to the diary hire type, and owned plant is neither', () => {
  assert.equal(hireTypeFromOwnership('wet_hire'), 'wet');
  assert.equal(hireTypeFromOwnership('dry_hire'), 'dry');
  assert.equal(hireTypeFromOwnership('own'), null);
  assert.equal(hireTypeFromOwnership(undefined), null);
});

test('the extraction sees name, hire type, supplier and aliases', () => {
  assert.deepEqual(asKnownPlant([{ id: 'x', name: 'Vac Truck', kind: 'vac_truck', plant_no: null, ownership: 'wet_hire', supplier: 'MINIQUIP', aliases: ['the vac'], sort_order: 1 }]),
    [{ item: 'Vac Truck', hire_type: 'wet', supplier: 'MINIQUIP', aliases: ['the vac'] }]);
});
