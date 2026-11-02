// Load the Kooboolong form templates (src/lib/forms/templates/*.json) into form_templates for one company, AS DRAFTS.
// The office reads each in the designer and issues it there — nothing is issued by this script. Re-runnable: a title
// already on file for the company (any revision, any status) is left alone.
//   node --env-file-if-exists=.env.local scripts/forms-seed-templates.mjs KBL
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const orgCode = process.argv[2];
if (!orgCode) { console.error('Usage: node --env-file-if-exists=.env.local scripts/forms-seed-templates.mjs <ORG CODE>'); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org, error: orgErr } = await db.from('organisations').select('id, name').eq('code', orgCode).single();
if (orgErr || !org) { console.error(`No organisation coded ${orgCode}.`); process.exit(1); }
const dir = join(process.cwd(), 'src', 'lib', 'forms', 'templates');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const { data: existing } = await db.from('form_templates').select('title').eq('org_id', org.id);
const have = new Set((existing ?? []).map((r) => r.title.trim().toLowerCase()));
console.log(`${org.name} (${orgCode})`);
console.log('| File | Title | Category | About | Questions | Result |');
console.log('|---|---|---|---|---|---|');
for (const f of files) {
  const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const n = t.spec.sections.reduce((s, sec) => s + sec.questions.length, 0);
  let result = 'already there';
  if (!have.has(t.title.trim().toLowerCase())) {
    const { error } = await db.from('form_templates').insert({
      org_id: org.id, title: t.title, category: t.category, profile: t.profile, subject: t.subject, audience: t.audience,
      signature: t.signature, pass_mark: t.pass_mark, basis: t.basis, competency_key: t.competency_key, spec: t.spec,
    });
    result = error ? `FAILED — ${error.message.split('\n')[0]}` : 'loaded as a draft';
  }
  console.log(`| ${f} | ${t.title} | ${t.category} | ${t.subject} | ${n} | ${result} |`);
}
console.log('\nDrafts are issued from /forms/design, one at a time, after reading each.');
