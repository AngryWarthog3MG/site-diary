import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateProblems, type QaTemplate } from './model.ts';

/**
 * The transcribed forms in docs/qa-templates are held to the engine's own rules before they are seeded (README R182):
 * each must pass `templateProblems`, a `record` header field must name a form that is itself on file, and the one
 * change between a revision and the next is the change the README row says it is.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'qa-templates');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const specs = new Map(files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as QaTemplate]));
const codes = new Set([...specs.values()].map((t) => t.code));

test('every transcribed form issues cleanly and is filed under its own code and revision', () => {
  assert.ok(files.length >= 11);
  for (const [f, t] of specs) {
    assert.deepEqual(templateProblems(t), [], f);
    assert.equal(f, `${t.code}.${t.revision}.json`, `${f} is filed as its code and revision`);
  }
});

test('a record header field picks from a form that is on file', () => {
  for (const [f, t] of specs) {
    for (const h of t.header_fields ?? []) if (h.type === 'record') assert.ok(h.template_code && codes.has(h.template_code), `${f}: ${h.key} picks from ${h.template_code}`);
  }
});

test('ITR-002 Rev C is Rev B with the earthworks lot picked from the job\'s ITR-001 records', () => {
  const b = specs.get('6425-KBS-ITR-002.B.json')!; const c = specs.get('6425-KBS-ITR-002.C.json')!;
  const strip = (t: QaTemplate) => JSON.stringify({ ...t, revision: null, header_fields: (t.header_fields ?? []).filter((h) => h.key !== 'earthworks_lot') });
  assert.equal(strip(b), strip(c), 'every other word the same');
  assert.deepEqual(c.header_fields?.find((h) => h.key === 'earthworks_lot'), { key: 'earthworks_lot', label: 'Earthworks lot (ITR-001)', type: 'record', template_code: '6425-KBS-ITR-001' });
});
