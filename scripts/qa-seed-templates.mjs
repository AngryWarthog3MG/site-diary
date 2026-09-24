// Load the transcribed QA templates (docs/qa-templates/*.json) into qa_templates for one company, as issued.
// Re-runnable: a (code, revision) already there is left alone — an issued revision is frozen by the database.
//   node --env-file-if-exists=.env.local scripts/qa-seed-templates.mjs KBL
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const orgCode = process.argv[2] ?? 'KBL';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org, error: orgErr } = await db.from('organisations').select('id, name').eq('code', orgCode).single();
if (orgErr || !org) { console.error(`No organisation coded ${orgCode}.`); process.exit(1); }
const dir = join(process.cwd(), 'docs', 'qa-templates');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const count = (t) => {
  const items = (t.sections ?? []).flatMap((s) => s.items);
  return {
    items: items.length,
    columns: (t.columns ?? []).length + (t.sub_register?.columns?.length ?? 0),
    activities: (t.activities ?? []).length,
    signoffs: (t.signoffs ?? []).length,
    header: (t.header_fields ?? []).length,
    holds: items.filter((i) => i.hold_point).length + (t.activities ?? []).filter((a) => Object.values(a.inspection ?? {}).some((m) => /H/.test(m))).length,
  };
};
console.log(`${org.name} (${orgCode})`);
console.log('| Source form | Template code | Rev | Kind | Items | Columns | Activities | Sign-offs | Header fields | Hold points | Result |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const f of files) {
  const spec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const c = count(spec);
  const { data: existing } = await db.from('qa_templates').select('id').eq('org_id', org.id).eq('code', spec.code).eq('revision', spec.revision).maybeSingle();
  let result = 'already there';
  if (!existing) {
    const { error } = await db.from('qa_templates').insert({ org_id: org.id, spec, issued_at: new Date().toISOString() });
    result = error ? `FAILED — ${error.message.split('\n')[0]}` : 'loaded, issued';
  }
  console.log(`| ${spec.source?.replace('docs/qa-source/', '') ?? '—'} | ${spec.code} | ${spec.revision} | ${spec.kind} | ${c.items} | ${c.columns} | ${c.activities} | ${c.signoffs} | ${c.header} | ${c.holds} | ${result} |`);
}
