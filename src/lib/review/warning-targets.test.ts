import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRegister, plantNeedingPrestart, prestartHref } from './warning-targets.ts';

test('the machines with no prestart, as named, once each', () => {
  const payload = { plant: [{ item: 'Excavator' }, { item: '5t excavator' }, { item: 'Vac truck' }, { item: 'excavator' }, { item: '' }] } as never;
  assert.deepEqual(plantNeedingPrestart(payload, ['5t Excavator']), ['Vac truck']);
  assert.deepEqual(plantNeedingPrestart(payload, []), ['Excavator', '5t excavator', 'Vac truck']);
});

test('a diary name finds its register machine by containment, the longest name winning', () => {
  const register = [{ id: 'a', name: 'Excavator' }, { id: 'b', name: 'Excavator 5t Kubota' }, { id: 'c', name: 'Vac truck' }];
  assert.equal(matchRegister('excavator', register)?.id, 'b');
  assert.equal(matchRegister('Kubota', register)?.id, 'b');
  assert.equal(matchRegister('vac', register)?.id, 'c');
  assert.equal(matchRegister('roller', register), null);
  assert.equal(matchRegister('  ', register), null);
});

test('the door opens on the machine when the register knows it', () => {
  assert.equal(prestartHref('p1', { id: 'm1', name: 'x' }), '/plant/new?project=p1&plant=m1');
  assert.equal(prestartHref('p1', null), '/plant/new?project=p1');
});
