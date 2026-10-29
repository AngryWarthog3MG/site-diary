// Bring an UNSIGNED QA record onto a newer issued revision of its form (README R174).
//   node --env-file-if-exists=.env.local scripts/qa-move-record.mjs <record id> <revision>
// The database decides: same company, same form code, a later issued revision, no sign-off on the record — anything
// else is refused and the record is untouched. A signed record never moves; print it as it was signed.
import { createClient } from '@supabase/supabase-js';

const [recordId, revision] = process.argv.slice(2);
if (!recordId || !revision) { console.error('usage: qa-move-record.mjs <record id> <revision>'); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: rec, error: recErr } = await db.from('qa_records').select('id, project_id, template_id, lot_or_element, signoffs, completed_at').eq('id', recordId).maybeSingle();
if (recErr || !rec) { console.error(`No record ${recordId}.`); process.exit(1); }
const { data: from } = await db.from('qa_templates').select('id, org_id, code, revision').eq('id', rec.template_id).single();
const { data: to } = await db.from('qa_templates').select('id, revision, issued_at').eq('org_id', from.org_id).eq('code', from.code).eq('revision', revision).maybeSingle();
if (!to) { console.error(`${from.code} has no Rev ${revision} for this company.`); process.exit(1); }
if (to.id === from.id) { console.log(`${rec.lot_or_element ?? recordId} is already on ${from.code} Rev ${revision}.`); process.exit(0); }
const { error } = await db.from('qa_records').update({ template_id: to.id }).eq('id', rec.id);
if (error) { console.error(`Refused: ${error.message.split('\n')[0]}`); process.exit(1); }
const { data: after } = await db.from('qa_records').select('template_id').eq('id', rec.id).single();
console.log(after.template_id === to.id ? `${rec.lot_or_element ?? recordId}: ${from.code} Rev ${from.revision} → Rev ${revision}.` : 'Nothing changed.');
