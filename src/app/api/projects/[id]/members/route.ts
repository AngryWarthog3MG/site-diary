import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MemberRole } from '@/types/database';
import { SCREENS, grantableScreens, type Screen } from '@/lib/roles';
import { cleanName } from '@/lib/people/name';

const ROLES = new Set<MemberRole>(['supervisor', 'leading_hand', 'labourer', 'pm', 'admin']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireProjectAdmin(projectId: string) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return { response };

  const { data, error } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { response: fail('server_error', error.message, 500) };
  if (data?.role !== 'admin') {
    return { response: fail('forbidden', 'Only a project admin can manage members.', 403) };
  }

  return { supabase, user, response: null as null };
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  // One indexed query, not a walk of the whole auth user list: every account
  // this app creates has a profiles row carrying its email.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

async function adminCount(projectId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('project_members')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('role', 'admin');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);

  const auth = await requireProjectAdmin(projectId);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const role = body?.role;
  if (!EMAIL_RE.test(email)) return fail('bad_request', 'Enter a valid email address.', 400);
  if (typeof role !== 'string' || !ROLES.has(role as MemberRole)) {
    return fail('bad_request', 'Role must be supervisor, pm, or admin.', 400);
  }

  let userId: string | null;
  try {
    userId = await findUserIdByEmail(email);
  } catch (error) {
    return fail('server_error', error instanceof Error ? error.message : 'Could not look up that account.', 500);
  }
  if (!userId) {
    return fail(
      'not_found',
      'That email has no account yet. Create it with the QR/onboarding operator flow, then add them here.',
      404,
    );
  }

  // Adding is adding, never a disguised role change. An upsert here would let
  // "add member" silently rewrite an existing membership — including demoting
  // the last admin (or yourself), which is exactly what the PATCH and DELETE
  // guards exist to prevent. Role changes must go through PATCH.
  const { data: existing } = await auth.supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) {
    return fail(
      'bad_request',
      `${email} is already on this project as ${existing.role}. Change their role from the member list instead.`,
      409,
    );
  }

  const { error } = await auth.supabase
    .from('project_members')
    .insert({ project_id: projectId, user_id: userId, role: role as MemberRole });
  if (error) return fail('server_error', error.message, 500);

  return ok({ message: `${email} is now a ${role}.` });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);

  const auth = await requireProjectAdmin(projectId);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const userId = body?.userId;
  const role = body?.role;
  if (!isUuid(userId)) return fail('bad_request', 'Bad user id.', 400);

  // The name printed on the sheets. An admin sets it for someone on THIS job — the
  // person can change their own at /name. Profiles only let a person write their own
  // row, so the write is the service role's, after the admin and membership checks.
  if (body && typeof body === 'object' && 'name' in body) {
    const result = cleanName((body as { name: unknown }).name);
    if (!result.ok) return fail('bad_request', result.message, 400);
    const { data: member, error: mErr } = await auth.supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
    if (mErr) return fail('server_error', mErr.message, 500);
    if (!member) return fail('not_found', 'That person is not on this job.', 404);
    const admin = createAdminClient();
    const { error } = await admin.from('profiles').update({ full_name: result.name }).eq('id', userId);
    if (error) return fail('server_error', error.message, 500);
    await admin.auth.admin.updateUserById(userId, { user_metadata: { full_name: result.name } }).catch(() => undefined);
    return ok({ message: `Name set: ${result.name}. New sheets will print it.` });
  }

  // Access by tick box: exactly these screens, or null for the role's own list. Checked
  // against the list of screens there are and this role's ceiling, so a stray name can
  // never be stored. An admin may set their own — `sees` keeps Settings open for them.
  if (body && typeof body === 'object' && 'screens' in body) {
    const raw = (body as { screens: unknown }).screens;
    if (raw !== null && !(Array.isArray(raw) && raw.every((s: unknown) => typeof s === 'string'))) {
      return fail('bad_request', 'Screens must be a list of screen names, or null for the role default.', 400);
    }
    const { data: member, error: mErr } = await auth.supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
    if (mErr) return fail('server_error', mErr.message, 500);
    if (!member) return fail('not_found', 'That person is not on this job.', 404);
    const allowed = new Set<string>(grantableScreens(member.role as MemberRole));
    if (raw !== null) {
      const unknown = (raw as string[]).filter((s) => !SCREENS.includes(s as Screen));
      if (unknown.length > 0) return fail('bad_request', `Not a screen: ${unknown.join(', ')}.`, 400);
      const over = (raw as string[]).filter((s) => !allowed.has(s));
      if (over.length > 0) return fail('bad_request', `A ${member.role} cannot hold: ${over.join(', ')}.`, 400);
    }
    const screens = raw === null ? null : Array.from(new Set(raw as string[]));
    const { error } = await auth.supabase.from('project_members').update({ screens }).eq('project_id', projectId).eq('user_id', userId);
    if (error) return fail('server_error', error.message, 500);
    return ok({ message: screens === null ? 'Back to the role’s own access.' : `Access set: ${screens.length} screen${screens.length === 1 ? '' : 's'}.`, screens });
  }

  if (typeof role !== 'string' || !ROLES.has(role as MemberRole)) {
    return fail('bad_request', 'Role must be supervisor, pm, or admin.', 400);
  }
  if (userId === auth.user.id) {
    return fail('bad_request', 'Ask another admin to change your role.', 400);
  }

  try {
    const [currentAdmins, { data: member }] = await Promise.all([
      adminCount(projectId),
      auth.supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (member?.role === 'admin' && role !== 'admin' && currentAdmins <= 1) {
      return fail('bad_request', 'A project needs at least one admin.', 400);
    }
  } catch (error) {
    return fail('server_error', error instanceof Error ? error.message : 'Could not check admins.', 500);
  }

  // The ticks were made against the old role; a new role starts from its own list.
  const { error } = await auth.supabase
    .from('project_members')
    .update({ role: role as MemberRole, screens: null })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) return fail('server_error', error.message, 500);

  return ok({ message: 'Member role updated.' });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);

  const auth = await requireProjectAdmin(projectId);
  if (auth.response) return auth.response;

  const body = await readJson(request);
  const userId = body?.userId;
  if (!isUuid(userId)) return fail('bad_request', 'Bad user id.', 400);
  if (userId === auth.user.id) {
    return fail('bad_request', 'Ask another admin to remove you from the project.', 400);
  }

  try {
    const [currentAdmins, { data: member }] = await Promise.all([
      adminCount(projectId),
      auth.supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (member?.role === 'admin' && currentAdmins <= 1) {
      return fail('bad_request', 'A project needs at least one admin.', 400);
    }
  } catch (error) {
    return fail('server_error', error instanceof Error ? error.message : 'Could not check admins.', 500);
  }

  const { error } = await auth.supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) return fail('server_error', error.message, 500);

  return ok({ message: 'Member removed.' });
}
