import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { sendWelcome } from '@/lib/members/welcome';
import { closeAccountIfOrphaned, reopenAccount } from '@/lib/members/account';
import { normaliseName } from '@/lib/crew/tickets';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The People page's writes (README R148): one person, added once with their login, their title and their jobs; a
 * job tick that puts them on the crew list AND on the job as a member; leaving, which takes them off every list and
 * closes the login. Nothing here is a copy — each step writes the record itself (staff, crew, project_members, the
 * account) under the rule that table already has: crew and staff under the caller's RLS (pm/admin keep them), a
 * membership only where the caller is an ADMIN of that job, money needing the caller's code (R105/R106).
 */
const ROLES = new Set<MemberRole>(['supervisor', 'leading_hand', 'labourer', 'pm', 'admin']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

async function adminOn(supabase: SupabaseClient, userId: string, projectIds: string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const { data } = await supabase.from('project_members').select('project_id, role').in('project_id', projectIds).eq('user_id', userId);
  return new Set(((data ?? []) as Array<{ project_id: string; role: string }>).filter((m) => m.role === 'admin').map((m) => m.project_id));
}

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** The account that carries this name on the sheets, if one does. */
async function findUserIdByName(admin: SupabaseClient, name: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id, full_name').not('full_name', 'is', null);
  const key = normaliseName(name);
  const hit = ((data ?? []) as Array<{ id: string; full_name: string }>).find((p) => normaliseName(p.full_name) === key);
  return hit?.id ?? null;
}

/** A membership on this job, if absent; the money rule as the bulk add applies it (R106). */
async function putOnJobAsMember(args: { supabase: SupabaseClient; admin: SupabaseClient; projectId: string; userId: string; role: MemberRole; byUserId: string; aal2: boolean }): Promise<'added' | 'already'> {
  const { admin, projectId, userId, role, aal2 } = args;
  const { data: existing } = await admin.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (existing) return 'already';
  if ((role === 'pm' || role === 'admin') && !aal2) throw new Error('Making someone a PM or admin needs your two-factor code. Enter it under Security, then try again.');
  const { error } = await admin.from('project_members').insert({ project_id: projectId, user_id: userId, role });
  if (error) throw new Error(error.message);
  return 'added';
}

/** The crew row: add one, show a hidden one, or hide the live one — under the caller's own RLS. */
async function setCrew(supabase: SupabaseClient, projectId: string, name: string, role: string | null, on: boolean): Promise<void> {
  const { data: rows, error } = await supabase.from('crew').select('id, name, active').eq('project_id', projectId);
  if (error) throw new Error(error.message);
  const key = normaliseName(name);
  const mine = ((rows ?? []) as Array<{ id: string; name: string; active: boolean }>).find((c) => normaliseName(c.name) === key) ?? null;
  if (on) {
    if (mine?.active) return;
    if (mine) {
      const { data, error: e } = await supabase.from('crew').update({ active: true }).eq('id', mine.id).select('id');
      if (e) throw new Error(e.message);
      if (!data?.length) throw new Error('Your role on that job does not keep its crew list.');
      return;
    }
    const { error: e } = await supabase.from('crew').insert({ project_id: projectId, name, role, sort_order: (rows?.length ?? 0) + 1 });
    if (e) throw new Error(/row-level security/i.test(e.message) ? 'Your role on that job does not keep its crew list.' : e.message);
    return;
  }
  if (!mine || !mine.active) return;
  const { data, error: e } = await supabase.from('crew').update({ active: false }).eq('id', mine.id).select('id');
  if (e) throw new Error(e.message);
  if (!data?.length) throw new Error('Your role on that job does not keep its crew list.');
}

/** Add a person — or give one already on the list a login — in one go. */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const orgId = body?.orgId;
  if (!isUuid(orgId)) return fail('bad_request', 'Bad company id.', 400);
  const name = String(body?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return fail('bad_request', 'Give the person’s name as it goes on the sheets.', 400);
  const staffRole = String(body?.role ?? '').replace(/\s+/g, ' ').trim() || null;
  const phone = String(body?.phone ?? '').trim() || null;
  const employer = String(body?.employer ?? '').trim() || null;
  const emergency = String(body?.emergencyContact ?? '').trim() || null;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = typeof body?.password === 'string' ? String(body.password) : '';
  const title = String(body?.title ?? 'labourer') as MemberRole;
  const jobs: string[] = Array.isArray(body?.jobs) ? (body.jobs as unknown[]).filter((j): j is string => typeof j === 'string' && isUuid(j)) : [];
  if (email && !EMAIL_RE.test(email)) return fail('bad_request', 'Enter a valid email address.', 400);
  if (email && !ROLES.has(title)) return fail('bad_request', 'Pick a title.', 400);
  if (password && password.length < 8) return fail('bad_request', 'A password is at least 8 characters.', 400);
  if (password && !email) return fail('bad_request', 'A password goes with an email.', 400);

  // Jobs must be the company's.
  const { data: jobRows } = jobs.length ? await supabase.from('projects').select('id, code, name, org_id').in('id', jobs) : { data: [] };
  const okJobs = ((jobRows ?? []) as Array<{ id: string; code: string; name: string; org_id: string }>).filter((j) => j.org_id === orgId);
  if (okJobs.length !== jobs.length) return fail('bad_request', 'One of those jobs is not this company’s.', 400);
  const admin = createAdminClient();
  const admins = email ? await adminOn(supabase, user.id, jobs) : new Set<string>();
  if (email && jobs.some((j) => !admins.has(j))) return fail('forbidden', 'Only an admin of a job puts someone on it with a login. Tick only the jobs you administer, or add them without an email.', 403);

  // 1. The staff row — the person. Already there by name: reused, blanks filled.
  let staffId: string;
  const { data: had } = await supabase.from('staff').select('id, name, role, phone, employer, emergency_contact, active').eq('org_id', orgId);
  const same = ((had ?? []) as Array<{ id: string; name: string; active: boolean; role: string | null; phone: string | null; employer: string | null; emergency_contact: string | null }>).find((s) => normaliseName(s.name) === normaliseName(name)) ?? null;
  if (same) {
    staffId = same.id;
    const patch: Record<string, unknown> = {};
    if (!same.role && staffRole) patch.role = staffRole;
    if (!same.phone && phone) patch.phone = phone;
    if (!same.employer && employer) patch.employer = employer;
    if (!same.emergency_contact && emergency) patch.emergency_contact = emergency;
    if (!same.active) patch.active = true;
    if (Object.keys(patch).length) { const { error } = await supabase.from('staff').update(patch).eq('id', staffId); if (error) return fail('server_error', error.message, 500); }
  } else {
    const { data: made, error } = await supabase.from('staff').insert({ org_id: orgId, name, role: staffRole, phone, employer, emergency_contact: emergency }).select('id').single();
    if (error) return fail(/row-level security/i.test(error.message) ? 'forbidden' : 'server_error', /row-level security/i.test(error.message) ? 'Your role does not keep the staff list.' : error.message, /row-level security/i.test(error.message) ? 403 : 500);
    staffId = made.id as string;
  }

  // 2. The crew rows — what the diary, the prestart and the gate offer.
  const crewFailed: string[] = [];
  for (const j of okJobs) { try { await setCrew(supabase, j.id, name, staffRole, true); } catch (e) { crewFailed.push(`${j.code} (${first(e)})`); } }

  // 3. The login — account, password, a membership per job, one welcome.
  let loginNote = '';
  if (email) {
    try {
      let userId = await findUserIdByEmail(admin, email);
      let madeAccount = false;
      if (!userId) {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, email_confirm: true, ...(password ? { password } : {}), user_metadata: { full_name: name } });
        if (cErr || !created.user) throw new Error(cErr?.message ?? 'Could not create the account.');
        userId = created.user.id;
        await admin.from('profiles').upsert({ id: userId, email, full_name: name });
        madeAccount = true;
      } else {
        await admin.from('profiles').update({ full_name: name }).eq('id', userId).is('full_name', null);
        if (password) { const { error: pErr } = await admin.auth.admin.updateUserById(userId, { password }); if (pErr) throw new Error(pErr.message); }
        if (okJobs.length) await reopenAccount(admin, userId, { projectId: okJobs[0].id, changedBy: user.id, newRole: title });
      }
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const aal2 = level?.currentLevel === 'aal2';
      const joined: string[] = [];
      for (const j of okJobs) {
        const r = await putOnJobAsMember({ supabase, admin, projectId: j.id, userId, role: title, byUserId: user.id, aal2 });
        if (r === 'added') joined.push(j.code);
      }
      if (madeAccount || joined.length) {
        const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
        const sent = await sendWelcome({ email, name, role: title, projectName: okJobs.map((j) => j.name).join(', ') || 'the company', addedBy: (me?.full_name as string | null) ?? null });
        loginNote = ` Login ${madeAccount ? 'made' : 'kept'} as ${ROLE_LABEL[title]}${joined.length ? ` on ${joined.join(', ')}` : ''}${password ? '; password set — tell them in person' : ''}.${sent ? ` A note went to ${email}.` : ' The welcome note did not send.'}`;
      } else {
        loginNote = ` Login already on ${okJobs.map((j) => j.code).join(', ')}.${password ? ' Password set — tell them in person.' : ''}`;
      }
    } catch (e) {
      loginNote = ` The login did not go through: ${first(e)}`;
    }
  }
  const on = okJobs.filter((j) => !crewFailed.some((f) => f.startsWith(j.code))).map((j) => j.code);
  return ok({
    staffId,
    message: `${name} ${same ? 'updated' : 'added'}${on.length ? ` and put on ${on.join(', ')}` : ''}.${crewFailed.length ? ` Not put on ${crewFailed.join('; ')}.` : ''}${loginNote}`,
  });
}

/** One job tick: the crew list and, where a login carries the name, the membership too. */
export async function PUT(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const staffId = body?.staffId; const projectId = body?.projectId; const on = Boolean(body?.on);
  const title = String(body?.title ?? 'labourer') as MemberRole;
  if (!isUuid(staffId) || !isUuid(projectId)) return fail('bad_request', 'Bad ids.', 400);
  if (!ROLES.has(title)) return fail('bad_request', 'Pick a title.', 400);
  const { data: s } = await supabase.from('staff').select('id, org_id, name, role, active').eq('id', staffId).maybeSingle();
  if (!s) return fail('not_found', 'That person is not on the staff list.', 404);
  const { data: job } = await supabase.from('projects').select('id, code, org_id').eq('id', projectId).maybeSingle();
  if (!job || job.org_id !== s.org_id) return fail('bad_request', 'That job is not this company’s.', 400);
  if (on && !s.active) return fail('bad_request', `${s.name} is marked as no longer with the company — bring them back first.`, 400);

  try { await setCrew(supabase, projectId, s.name as string, (s.role as string | null) ?? null, on); } catch (e) { return fail('forbidden', first(e), 403); }

  const admin = createAdminClient();
  const userId = await findUserIdByName(admin, s.name as string);
  let loginNote = '';
  if (userId) {
    const admins = await adminOn(supabase, user.id, [projectId]);
    if (!admins.has(projectId)) loginNote = ` Their login was not changed on ${job.code} — only an admin of that job does that.`;
    else if (on) {
      try {
        const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const r = await putOnJobAsMember({ supabase, admin, projectId, userId, role: title, byUserId: user.id, aal2: level?.currentLevel === 'aal2' });
        if (r === 'added') { await reopenAccount(admin, userId, { projectId, changedBy: user.id, newRole: title }); loginNote = ` Their login is on ${job.code} as ${ROLE_LABEL[title]}.`; }
      } catch (e) { loginNote = ` Their login was not put on ${job.code}: ${first(e)}`; }
    } else {
      if (userId === user.id) loginNote = ' Your own login stays on the job.';
      else {
        const { data: gone, error } = await admin.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId).select('role');
        if (error) loginNote = ` Their login was not taken off ${job.code}: ${first(error)}`;
        else if (gone?.length) {
          const closed = await closeAccountIfOrphaned(admin, userId, { projectId, changedBy: user.id, wasRole: (gone[0].role as string) ?? null }).catch(() => ({ outcome: 'left_open' as const }));
          loginNote = closed.outcome === 'closed' ? ' That was their last job, so their login is closed — ticking a job again reopens it.' : ` Their login is off ${job.code}.`;
        }
      }
    }
  }
  return ok({ message: on ? `${s.name} is on ${job.code}’s crew list.${loginNote}` : `${s.name} is off ${job.code}’s crew list. Days already recorded are unchanged.${loginNote}` });
}

/** Leaving the company: off every crew list (the staff trigger), off every job as a member, the login closed. */
export async function DELETE(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const staffId = body?.staffId;
  if (!isUuid(staffId)) return fail('bad_request', 'Bad id.', 400);
  const { data: s } = await supabase.from('staff').select('id, org_id, name, active').eq('id', staffId).maybeSingle();
  if (!s) return fail('not_found', 'That person is not on the staff list.', 404);
  const { data: upd, error } = await supabase.from('staff').update({ active: false }).eq('id', staffId).select('id');
  if (error) return fail('server_error', error.message, 500);
  if (!upd?.length) return fail('forbidden', 'Your role does not keep the staff list.', 403);

  const admin = createAdminClient();
  const userId = await findUserIdByName(admin, s.name as string);
  if (!userId) return ok({ message: `${s.name} is marked as no longer with the company and is off every crew list. They had no login.` });
  if (userId === user.id) return ok({ message: `${s.name} is off every crew list. Your own login stays — ask another admin to close it.` });
  const { data: mems } = await admin.from('project_members').select('project_id, role, project:projects!inner(org_id, code)').eq('user_id', userId);
  const rows = ((mems ?? []) as Array<{ project_id: string; role: string; project: { org_id: string; code: string } | Array<{ org_id: string; code: string }> }>)
    .map((m) => ({ ...m, project: Array.isArray(m.project) ? m.project[0] : m.project })).filter((m) => m.project.org_id === s.org_id);
  const admins = await adminOn(supabase, user.id, rows.map((m) => m.project_id));
  const kept: string[] = []; let last: { projectId: string; role: string } | null = null;
  for (const m of rows) {
    if (!admins.has(m.project_id)) { kept.push(m.project.code); continue; }
    const { error: dErr } = await admin.from('project_members').delete().eq('project_id', m.project_id).eq('user_id', userId);
    if (dErr) kept.push(m.project.code); else last = { projectId: m.project_id, role: m.role };
  }
  let note = '';
  if (last) {
    const closed = await closeAccountIfOrphaned(admin, userId, { projectId: last.projectId, changedBy: user.id, wasRole: last.role }).catch(() => ({ outcome: 'left_open' as const }));
    note = closed.outcome === 'closed' ? ' Their login is closed.' : ` Their login stays open on ${kept.join(', ')}.`;
  }
  return ok({ message: `${s.name} is marked as no longer with the company and is off every crew list.${note}${kept.length && !last ? ` Their login on ${kept.join(', ')} was left — you are not an admin there.` : ''}` });
}
