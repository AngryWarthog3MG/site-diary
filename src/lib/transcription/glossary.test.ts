import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyterms, CONSTRUCTION_GLOSSARY } from './glossary.ts';

test('project vocabulary comes before the fixed glossary', () => {
  const terms = buildKeyterms(['Danny Rowe', 'Kobelco 35']);
  assert.equal(terms[0], 'Danny Rowe');
  assert.equal(terms[1], 'Kobelco 35');
  assert.ok(terms.includes('slump'));
});

test('deduplicates case-insensitively, keeping the project spelling', () => {
  const terms = buildKeyterms(['Slump', 'slump', 'SLUMP']);
  assert.equal(terms.filter((t) => t.toLowerCase() === 'slump').length, 1);
  assert.equal(terms[0], 'Slump');
});

test('normalises whitespace and drops unusable terms', () => {
  const terms = buildKeyterms(['  Area   B  North ', 'x', 'y'.repeat(80)]);
  assert.ok(terms.includes('Area B North'));
  assert.ok(!terms.includes('x'));
  assert.ok(!terms.some((t) => t.length > 60));
});

test('truncates to the token budget without dropping project terms first', () => {
  // Far more project vocabulary than Deepgram will accept in one request.
  const crew = Array.from({ length: 400 }, (_, i) => `Supervisor Number ${i}`);
  const terms = buildKeyterms(crew);

  assert.ok(terms.length < crew.length, 'budget was not applied');
  assert.equal(terms[0], 'Supervisor Number 0');

  // Every term that survived is a project term: the glossary yields first.
  assert.ok(
    terms.every((t) => t.startsWith('Supervisor Number')),
    'glossary displaced project vocabulary',
  );

  const tokens = terms.reduce((sum, t) => sum + t.split(/\s+/).length + 1, 0);
  assert.ok(tokens <= 400, `estimated ${tokens} tokens, over budget`);
});

test('an empty project still gets the full glossary', () => {
  const terms = buildKeyterms([]);
  assert.equal(terms.length, CONSTRUCTION_GLOSSARY.length);
  assert.ok(terms.includes('hold point'));
});
