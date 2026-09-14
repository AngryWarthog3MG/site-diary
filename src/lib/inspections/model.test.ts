import test from 'node:test';
import assert from 'node:assert/strict';
import { templateFromLines, builtInItems, readItems, answered, findings, BUILT_IN_TEMPLATES } from './model.ts';

test('a template typed one line at a time gets stable, unique keys', () => {
  const items = templateFromLines('Housekeeping — walkways clear\n\n  Housekeeping — walkways clear \nPPE');
  assert.equal(items.length, 3);
  assert.equal(items[0].key, 'housekeeping_walkways_clear');
  assert.notEqual(items[0].key, items[1].key);
  assert.equal(items[2].key, 'ppe');
});

test('the built-in templates are complete and keyed', () => {
  assert.equal(BUILT_IN_TEMPLATES.length, 4);
  for (const t of BUILT_IN_TEMPLATES) {
    const items = builtInItems(t);
    assert.ok(items.length >= 8, t.name);
    assert.equal(new Set(items.map((i) => i.key)).size, items.length, t.name);
  }
});

test('stored items read back tolerant of junk, and findings are the issues', () => {
  const items = readItems([
    { key: 'a', label: 'A', result: 'ok' },
    { key: 'b', label: 'B', result: 'issue', note: 'Barrier down', photo_urls: ['p/x.jpg', 7] },
    { key: 'c', label: 'C', result: 'bogus' },
    'junk',
  ]);
  assert.equal(items.length, 4);
  assert.equal(answered(items), 2);
  assert.deepEqual(findings(items).map((f) => f.key), ['b']);
  assert.deepEqual(items[1].photo_urls, ['p/x.jpg']);
  assert.equal(items[2].result, null);
});
