import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MemberRole } from '@/types/database';

const ROLES = new Set<MemberRole>(['supervisor', 'leading_hand', 'labourer', 'pm', 'admin']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 60;

/**
 * Seat a whole crew at once. One line per person — "Sam Nguyen <sam@x.com>",
 * "Sam Nguyen, sam@x.com" or just the address — all with one role. An
 * address with no account yet gets one (confirmed, no email sent: they sign
 * in by magic link or a printed card); an address already on the job is
 * left as it is and said so. Admin only, like the single add.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { data: me } = await supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (me?.role !== 'admin') return fail('forbidden', 'Only a project admin can manage members.', 403);

  const body = await readJson(request);
  const role = body?.role;
  if (typeof role !== 'string' || !ROLES.has(role as MemberRole)) return fail('bad_request', 'Pick a role.', 400);
  const people = parsePeople(String(body?.lines ?? ''));
  if (people.length === 0) return fail('bad_request', 'Paste at least one line: a name and an email address.', 400);
  if (people.length > MAX) return fail('bad_request', `Up to ${MAX} at a time.`, 400);

  const admin = createAdminClient();
  const results: Array<{ email: string; name: string | null; outcome: 'added' | 'already' | 'invalid' | 'failed'; detail?: string }> = [];
  for (const p of people) {
    if (!EMAIL_RE.test(p.email)) { results.push({ ...p, outcome: 'invalid' }); continue; }
    try {
      let userId: string | null = null;
      const { data: prof } = await admin.from('profiles').select('id').ilike('email', p.email).maybeSingle();
      userId = (prof?.id as string | undefined) ?? null;
      if (!userId) {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: p.email, email_confirm: true, user_metadata: p.name ? { full_name: p.name } : {} });
        if (cErr || !created.user) throw new Error(cErr?.message ?? 'Could not create the account.');
        userId = created.user.id;
        await admin.from('profiles').upsert({ id: userId, email: p.email, full_name: p.name });
      } else if (p.name) {
        // A name given here fills a blank one; it never overwrites what the person has.
        await admin.from('profiles').update({ full_name: p.name }).eq('id', userId).is('full_name', null);
      }
      const { data: existing } = await admin.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
      if (existing) { results.push({ ...p, outcome: 'already', detail: String(existing.role) }); continue; }
      const { error: mErr } = await admin.from('project_members').insert({ project_id: projectId, user_id: userId, role: role as MemberRole });
      if (mErr) throw new Error(mErr.message);
      results.push({ ...p, outcome: 'added' });
    } catch (err) {
      results.push({ ...p, outcome: 'failed', detail: err instanceof Error ? err.message : 'failed' });
    }
  }
  return ok({ role, results, added: results.filter((r) => r.outcome === 'added').length });
}

/** "Name <email>", "Name, email", "email Name" or "email" — one per line. */
export function parsePeople(text: string): Array<{ name: string | null; email: string }> {
  const out: Array<{ name: string | null; email: string }> = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /<([^>]+)>/.exec(line);
    const tokens = line.replace(/[<>,;\t]/g, ' ').split(/\s+/).filter(Boolean);
    const email = (m ? m[1] : tokens.find((t) => t.includes('@')) ?? '').trim().toLowerCase();
    const name = tokens.filter((t) => !t.includes('@')).join(' ').replace(/\s+/g, ' ').trim() || null;
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ name, email });
  }
  return out;
}
