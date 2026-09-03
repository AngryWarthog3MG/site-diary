import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTalkSummary } from './summary.ts';

test('a heading is a colon line with something under it', () => {
  assert.deepEqual(parseTalkSummary('Why this matters:\nBecause it does.'), [
    { kind: 'heading', text: 'Why this matters' },
    { kind: 'para', text: 'Because it does.' },
  ]);
});

test('a lone colon line is a paragraph, not a heading with nothing under it', () => {
  assert.deepEqual(parseTalkSummary('Watch this:'), [{ kind: 'para', text: 'Watch this:' }]);
});

test('points become a list', () => {
  assert.deepEqual(parseTalkSummary('- Boots on\n- Gloves on'), [
    { kind: 'points', items: ['Boots on', 'Gloves on'] },
  ]);
});

test('a block that mixes prose and points keeps them apart', () => {
  // The bug this pins: "- " printed mid-sentence in the middle of a paragraph.
  assert.deepEqual(parseTalkSummary('Ladders:\nCheck it first.\n- Three points of contact\n- Face the ladder'), [
    { kind: 'heading', text: 'Ladders' },
    { kind: 'para', text: 'Check it first.' },
    { kind: 'points', items: ['Three points of contact', 'Face the ladder'] },
  ]);
});

test('wrapped prose lines join into one paragraph', () => {
  assert.deepEqual(parseTalkSummary('One line\nand its continuation.'), [
    { kind: 'para', text: 'One line and its continuation.' },
  ]);
});

test('blank lines separate blocks, and stray whitespace is ignored', () => {
  assert.deepEqual(parseTalkSummary('First.\n\n   \n\nSecond.'), [
    { kind: 'para', text: 'First.' },
    { kind: 'para', text: 'Second.' },
  ]);
});

test('plain text with no structure at all still renders', () => {
  assert.deepEqual(parseTalkSummary('Just talk about the weather.'), [
    { kind: 'para', text: 'Just talk about the weather.' },
  ]);
});
