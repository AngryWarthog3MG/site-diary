import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blanksAsGaps, gapCount, nextRevision, recordState, released, signoffsComplete, templateCounts, templateProblems, type QaTemplate } from './model.ts';

const checklist: QaTemplate = {
  code: 'KBS-QA-X', kind: 'itr_checklist', title: 'Pre-pour', revision: 'A', hold_point: true,
  sections: [{ title: 'A', items: [{ id: '1', text: 'Set-out checked' }, { id: '2', text: 'Formwork', hold_point: true }] }, { title: 'B', items: [{ id: '3', text: 'Reo' }] }],
  signoffs: [{ party: 'Kooboolong Supervisor', required: true, kind: 'internal' }, { party: 'CDI Site Manager - release to pour', required: true, kind: 'external', is_release: true }],
};
const sig = (party: string) => ({ party, signer_name: 'A Person', signature_path: 'p/qa/r/sig.png', signed_at: '2026-09-24T01:00:00Z' });

test('a template is checked before it is saved', () => {
  assert.deepEqual(templateProblems(checklist), []);
  assert.ok(templateProblems({ ...checklist, sections: [{ title: 'A', items: [{ id: '1', text: 'x' }, { id: '1', text: 'y' }] }] }).includes('item 1 twice'));
  assert.ok(templateProblems({ ...checklist, hold_point: false }).includes('a release sign-off only on a hold point form'));
  assert.ok(templateProblems({ code: 'I', kind: 'itp', title: 't', revision: 'A', parties: ['Kooboolong'], activities: [{ no: '1', activity: 'x', governing: [], criteria: [], record: [], inspection: { Lendlease: 'H', Kooboolong: 'X' } }] }).some((p) => p.includes('unknown party')));
  assert.ok(templateProblems({ code: 'R', kind: 'itr_register', title: 't', revision: 'A', columns: [] }).includes('at least one column'));
});

test('blank items become gaps at submit, in template order; gaps are counted', () => {
  const filled = blanksAsGaps(checklist, [{ item_id: '3', state: 'ok' }, { item_id: '1', state: 'na' }]);
  assert.deepEqual(filled.map((r) => `${r.item_id}:${r.state}`), ['1:na', '2:gap', '3:ok']);
  assert.equal(gapCount(filled), 1);
});

test('a hold point record is released only when every release party has signed, and reads as gaps open when it has any', () => {
  const base = { items: [{ item_id: '1', state: 'ok' as const }, { item_id: '2', state: 'ok' as const }, { item_id: '3', state: 'ok' as const }], signoffs: [] as ReturnType<typeof sig>[] };
  assert.equal(recordState(checklist, base), 'in_progress');
  assert.equal(recordState(checklist, { ...base, submitted_at: 'x' }), 'awaiting_release');
  assert.equal(recordState(checklist, { ...base, signoffs: [sig('Kooboolong Supervisor')] }), 'awaiting_release');
  assert.equal(released(checklist, { ...base, signoffs: [sig('Kooboolong Supervisor')] }), false);
  const both = { ...base, signoffs: [sig('Kooboolong Supervisor'), sig('CDI Site Manager - release to pour')] };
  assert.equal(signoffsComplete(checklist, both), true);
  assert.equal(recordState(checklist, both), 'released');
  assert.equal(recordState(checklist, { ...both, items: [{ item_id: '1', state: 'gap' }, ...base.items.slice(1)] }), 'gaps_open');
  assert.equal(recordState(checklist, { ...both, voided_at: 'x' }), 'voided');
  const plain = { ...checklist, hold_point: false, signoffs: [checklist.signoffs![0]] };
  assert.equal(recordState(plain, { ...base, signoffs: [sig('Kooboolong Supervisor')] }), 'complete');
});

test('revisions advance like a drawing register', () => {
  assert.equal(nextRevision('A'), 'B');
  assert.equal(nextRevision('b'), 'C');
  assert.equal(nextRevision('Z'), 'AA');
  assert.equal(nextRevision('0'), '1');
});

test('counts for the transcription table', () => {
  const c = templateCounts(checklist);
  assert.deepEqual(c, { items: 3, columns: 0, activities: 0, signoffs: 2, header_fields: 0, hold_points: 1 });
});
