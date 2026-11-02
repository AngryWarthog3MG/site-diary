import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSpec, templateProblems, FORM_CATEGORIES, PROFILES, SUBJECTS, SIGNATURE_RULES, AUDIENCE_ROLES, questions } from './model.ts';

/**
 * The Kooboolong templates (README R181) are held to the engine's own rules before they are ever seeded: each one
 * must issue cleanly, name a real category, profile, subject and signature rule, and ask something. A template the
 * designer would refuse never reaches the seed script.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), 'templates');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

test('twelve templates are on file', () => {
  assert.deepEqual(files, [
    'excavator-crack-inspection.json', 'fatigue-check.json', 'field-leadership-observation.json', 'journey-management-plan.json',
    'plant-off-hire.json', 'plant-on-hire.json', 'take-time.json', 'training-evaluation.json',
    'voc-excavator.json', 'voc-loader.json', 'voc-roller.json', 'workplace-hazard-inspection.json',
  ]);
});

for (const f of files) {
  test(`${f} issues cleanly under the engine's rules`, () => {
    const t = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
    assert.ok(typeof t.title === 'string' && t.title.trim().length > 0, 'title');
    assert.ok((FORM_CATEGORIES as readonly string[]).includes(t.category as string), `category ${t.category}`);
    assert.ok((PROFILES as readonly string[]).includes(t.profile as string), `profile ${t.profile}`);
    assert.ok((SUBJECTS as readonly string[]).includes(t.subject as string), `subject ${t.subject}`);
    assert.ok((SIGNATURE_RULES as readonly string[]).includes(t.signature as string), `signature ${t.signature}`);
    assert.ok(Array.isArray(t.audience) && (t.audience as string[]).every((r) => (AUDIENCE_ROLES as readonly string[]).includes(r)), 'audience roles');
    assert.ok(t.pass_mark === null || (Number.isInteger(t.pass_mark) && (t.pass_mark as number) >= 0 && (t.pass_mark as number) <= 100), 'pass mark');
    assert.ok(typeof t.basis === 'string' && (t.basis as string).length > 20, 'a basis that says what requires it');
    const spec = readSpec(t.spec);
    assert.deepEqual(templateProblems(spec), []);
    const qs = questions(spec);
    assert.ok(qs.length >= 5, 'asks something');
    for (const q of qs) assert.ok(q.label.length <= 160, `${q.key}: wording fits a phone`);
    if (t.competency_key) assert.equal(t.subject, 'person', 'a VOC is about a person');
    if (f.startsWith('voc-')) assert.equal(t.pass_mark, 100, 'a VOC passes whole or not at all');
  });
}
