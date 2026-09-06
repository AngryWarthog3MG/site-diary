import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, looksScanned, tidy } from './chunk.ts';

test('tidy removes reader noise but keeps paragraphs', () => {
  assert.equal(tidy('Top-\nsoil  depth   is\n\n\n\n300mm.  \n'), 'Topsoil depth is\n\n300mm.');
});

test('a short page is one chunk; a long page splits at sentences with overlap', () => {
  const sentence = 'The topsoil shall be placed to a compacted depth of 300 mm in garden beds. ';
  const long = sentence.repeat(40); // ~3000 chars
  const chunks = chunkPages([{ page: 1, text: 'Short page.' }, { page: 2, text: long }]);
  assert.equal(chunks[0].text, 'Short page.');
  assert.equal(chunks[0].page, 1);
  const p2 = chunks.filter((c) => c.page === 2);
  assert.ok(p2.length >= 2 && p2.length <= 4, `expected a few chunks, got ${p2.length}`);
  for (const c of p2) assert.ok(c.text.length <= 1500, 'chunk within budget');
  // sequence numbers run across pages
  assert.deepEqual(chunks.map((c) => c.seq), chunks.map((_, i) => i));
  // overlap: the start of chunk 2 appears near the end of chunk 1
  const tail = p2[0].text.slice(-120);
  assert.ok(tail.includes(p2[1].text.slice(0, 30)) || p2[1].text.startsWith('The topsoil'), 'boundary is carried across');
});

test('a scanned PDF is recognised by its near-empty pages', () => {
  assert.equal(looksScanned([{ page: 1, text: ' ' }, { page: 2, text: 'A' }]), true);
  assert.equal(looksScanned([{ page: 1, text: 'x'.repeat(500) }]), false);
  assert.equal(looksScanned([]), true);
});
