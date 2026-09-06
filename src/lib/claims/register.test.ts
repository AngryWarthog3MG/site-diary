import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemValue, summariseRegister } from './register.ts';

test('an item is worth what was agreed, else what was estimated, else nothing', () => {
  assert.equal(itemValue({ estimated_cost: 800, agreed_cost: 1250 }), 1250);
  assert.equal(itemValue({ estimated_cost: 800, agreed_cost: null }), 800);
  assert.equal(itemValue({ estimated_cost: null, agreed_cost: null }), null);
});

test('not yet submitted is raised plus priced; approved-unpaid is the money owed', () => {
  const s = summariseRegister([
    { status: 'raised', estimated_cost: 500, agreed_cost: null },
    { status: 'priced', estimated_cost: 1200, agreed_cost: null },
    { status: 'submitted', estimated_cost: 900, agreed_cost: null },
    { status: 'approved', estimated_cost: 900, agreed_cost: 850 },
    { status: 'paid', estimated_cost: null, agreed_cost: 2000 },
    { status: 'raised', estimated_cost: null, agreed_cost: null },
  ]);
  assert.deepEqual(s.notSubmitted, { count: 3, value: 1700 });
  assert.deepEqual(s.approvedUnpaid, { count: 1, value: 850 });
  assert.equal(s.total, 6);
  assert.deepEqual(s.byStatus.find((b) => b.status === 'raised'), { status: 'raised', count: 2, value: 500 });
  assert.deepEqual(s.byStatus.find((b) => b.status === 'rejected'), { status: 'rejected', count: 0, value: 0 });
});
