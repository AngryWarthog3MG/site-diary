import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePour, type DocketRead } from './reconcile.ts';

const read = (overrides: Partial<DocketRead>): DocketRead => ({
  docket_no: null,
  volume_m3: null,
  mix_spec: null,
  supplier: null,
  legible: true,
  issue: null,
  ...overrides,
});

test('the docket wins where it differs from what was spoken', () => {
  const { patch, changes } = reconcilePour(
    { volume_m3: 12, mix_spec: 'N32', supplier: null, docket_nos: [] },
    read({ docket_no: '48213', volume_m3: 12.5, mix_spec: 'S40', supplier: 'Holcim' }),
  );
  assert.equal(patch.volume_m3, 12.5);
  assert.equal(patch.mix_spec, 'S40');
  assert.equal(patch.supplier, 'Holcim');
  assert.deepEqual(patch.docket_nos, ['48213']);
  assert.equal(changes.length, 4);
  const volume = changes.find((c) => c.field === 'volume_m3');
  assert.equal(volume?.from, '12');
  assert.equal(volume?.to, '12.5');
});

test('spoken values stand where the docket is silent', () => {
  const { patch, changes } = reconcilePour(
    { volume_m3: 12, mix_spec: 'N32', docket_nos: [] },
    read({ docket_no: '48213', volume_m3: null, mix_spec: null }),
  );
  assert.equal(patch.volume_m3, undefined);
  assert.equal(patch.mix_spec, undefined);
  assert.equal(changes.length, 1); // only the docket number
});

test('agreement produces no change beyond the docket number', () => {
  const { patch, changes } = reconcilePour(
    { volume_m3: 12.5, mix_spec: 'n32 ', docket_nos: [] },
    read({ docket_no: '48213', volume_m3: 12.5, mix_spec: 'N32' }),
  );
  assert.equal(patch.volume_m3, undefined);
  assert.equal(patch.mix_spec, undefined);
  assert.deepEqual(changes.map((c) => c.field), ['docket_nos']);
});

test('a second docket never overwrites the pour totals', () => {
  const { patch, changes } = reconcilePour(
    { volume_m3: 18, mix_spec: 'N32', docket_nos: ['48213'] },
    read({ docket_no: '48214', volume_m3: 6, mix_spec: 'S40' }),
  );
  assert.equal(patch.volume_m3, undefined, 'one truck’s load is not the pour’s total');
  assert.equal(patch.mix_spec, undefined);
  assert.deepEqual(patch.docket_nos, ['48213', '48214']);
  assert.equal(changes.length, 1);
});

test('a docket number already on the pour is not duplicated', () => {
  const { patch, changes } = reconcilePour(
    { docket_nos: ['48213'] },
    read({ docket_no: ' 48213 ' }),
  );
  assert.equal(patch.docket_nos, undefined);
  assert.equal(changes.length, 0);
});
