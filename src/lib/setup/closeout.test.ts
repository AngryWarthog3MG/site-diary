import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobSpecifics, promotable, suggestGeneric, undecided, type Promotable } from './closeout.ts';

test('only the job’s own items are up for a decision, and only until decided', () => {
  const rows = [
    { id: 't', origin: 'template', promotion_decision: null, promoted_template_item_id: null },
    { id: 'm', origin: 'manual', promotion_decision: null, promoted_template_item_id: null },
    { id: 'c', origin: 'contract', promotion_decision: null, promoted_template_item_id: null },
    { id: 'p', origin: 'contract', promotion_decision: 'promoted', promoted_template_item_id: 'x' },
    { id: 'o', origin: 'manual', promotion_decision: 'one_off', promoted_template_item_id: null },
  ] as unknown as Array<Promotable & { id: string }>;
  assert.deepEqual(undecided(rows).map((r) => r.id), ['m', 'c']);
  assert.equal(promotable({ origin: 'template' }), false);
  assert.equal(promotable({ origin: 'contract' }), true);
});

test('the head contractor and the job are replaced, possessives kept, capitals kept', () => {
  const names = { headContractor: 'CDI', projectName: 'Kalgoorlie- Somerville Airport Hotel' };
  assert.equal(suggestGeneric('Have the cap corrected before CDI signs', names), 'Have the cap corrected before the head contractor signs');
  assert.equal(suggestGeneric('Review CDI’s amended terms when issued', names), 'Review the head contractor’s amended terms when issued');
  assert.equal(suggestGeneric('CDI may terminate at any time', names), 'The head contractor may terminate at any time');
  assert.equal(suggestGeneric('Programme for Kalgoorlie- Somerville Airport Hotel received', names), 'Programme for the job received');
  // A word that merely contains the letters is left alone.
  assert.equal(suggestGeneric('Decide who does it', { headContractor: 'CDI' }), 'Decide who does it');
});

test('what must not survive into a template is named', () => {
  const names = { headContractor: 'CDI', projectName: 'Kalgoorlie- Somerville Airport Hotel' };
  assert.deepEqual(jobSpecifics('Evidence to CDI before starting', names), ['CDI']);
  assert.deepEqual(jobSpecifics('Evidence to the head contractor before starting', names), []);
  assert.deepEqual(jobSpecifics('x', { headContractor: null, projectName: '' }), []);
});
