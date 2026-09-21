import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsByKind, folderName, itemProblems, orderItems, TEMPLATE_KINDS } from './model.ts';

test('counts are of live items, every kind present even at zero', () => {
  const c = countsByKind([
    { kind: 'start_gate', active: true }, { kind: 'start_gate', active: true }, { kind: 'start_gate', active: false },
    { kind: 'consumable', active: true },
  ]);
  assert.equal(c.start_gate, 2);
  assert.equal(c.consumable, 1);
  assert.equal(c.risk, 0);
  assert.deepEqual(Object.keys(c), [...TEMPLATE_KINDS]);
});

test('live items first in sort order, then category and title; retired last', () => {
  const rows = [
    { id: 'r', active: false, sort: 1, category: null, title: 'Retired' },
    { id: 'b', active: true, sort: 20, category: 'Safety', title: 'B' },
    { id: 'a', active: true, sort: 20, category: 'Contract', title: 'Z' },
    { id: 'c', active: true, sort: 10, category: null, title: 'C' },
  ];
  assert.deepEqual(orderItems(rows).map((r) => r.id), ['c', 'a', 'b', 'r']);
});

test('the editor asks for what the database would refuse', () => {
  assert.deepEqual(itemProblems({ kind: 'document', title: 'Insurance', folder_no: null, par_level: null, unit: null }), ['which folder (1–12)']);
  assert.deepEqual(itemProblems({ kind: 'consumable', title: 'Paint', folder_no: null, par_level: 6, unit: '' }), ['a unit for the par level']);
  assert.deepEqual(itemProblems({ kind: 'risk', title: '  ', folder_no: null, par_level: null, unit: null }), ['a title']);
  assert.deepEqual(itemProblems({ kind: 'start_gate', title: 'Signed LOI', folder_no: null, par_level: null, unit: null }), []);
});

test('folders read as the brief names them', () => {
  assert.equal(folderName(1), '01 Contract');
  assert.equal(folderName(11), '11 Diaries and Photos');
  assert.equal(folderName(null), '—');
});
