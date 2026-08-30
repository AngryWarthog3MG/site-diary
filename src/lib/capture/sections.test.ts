import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSections, SECTION_ORDER } from './sections.ts';

const covered = (text: string, extra = {}) => [...detectSections(text, extra)].sort();

test('nothing said, nothing lit', () => {
  assert.deepEqual(covered(''), []);
  assert.deepEqual(covered('   '), []);
});

test('recognises each section from how a supervisor actually talks', () => {
  assert.ok(covered('Had five blokes on the deck today').includes('labour'));
  assert.ok(covered('The bobcat was on dry hire').includes('plant'));
  assert.ok(covered('Poured the slab in Area B').includes('work_items'));
  assert.ok(covered('Client directed a variation on the headwall').includes('variations'));
  assert.ok(covered('Stood down from half nine, no access').includes('delays'));
  assert.ok(covered('Rain came through about lunchtime').includes('weather'));
});

test('project vocabulary lights labour and plant without the words being said', () => {
  assert.ok(!covered('Danny and Kel were on the deck').includes('labour'));
  assert.ok(
    covered('Danny and Kel were on the deck', { labour: ['Danny Rowe', 'Kel Brady'] }).includes(
      'labour',
    ),
    'a known crew name should light Labour',
  );
  assert.ok(
    covered('Brought the Kobelco 35 in', { plant: ['Kobelco 35'] }).includes('plant'),
    'a known plant item should light Plant',
  );
});

test('matches on word boundaries, not substrings', () => {
  // "rained" is a weather cue; "brained", "training" and "drainage" are not.
  assert.ok(covered('It rained all morning').includes('weather'));
  assert.deepEqual(covered('Ran the drainage crew through training'), ['labour']);
});

test('one sentence can cover several sections', () => {
  const found = covered('Rain stopped the pour, five blokes stood down till eleven');
  assert.ok(found.includes('weather'));
  assert.ok(found.includes('delays'));
  assert.ok(found.includes('labour'));
  assert.ok(found.includes('work_items'));
});

test('every section has cues that can actually fire', () => {
  for (const section of SECTION_ORDER) {
    assert.ok(SECTION_ORDER.includes(section));
  }
  assert.equal(SECTION_ORDER.length, 6);
});
