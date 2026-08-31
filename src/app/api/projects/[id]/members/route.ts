import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MemberRole } from '@/types/database';

const ROLES = new Set<MemberRole>(['supervisor', 'pm', 'admin']);
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
  const admin = createAdminClient();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const found = data.users.find((user) => (user.email ?? '').toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 1000) return null;
    page += 1;
  }
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
  if (typeof role !== 'string' || !ROLES.has(role as MemberRole)) {
    return fail('bad_request', 'Role must be supervisor, pm, or admin.', 400);
  }
  if (userId === auth.user.id) {
    return fail('bad_request', 'Ask another admin to change your role.', 400);
  }

  try {
    const currentAdmins = await adminCount(projectId);
    const { data: member } = await auth.supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (member?.role === 'admin' && role !== 'admin' && currentAdmins <= 1) {
      return fail('bad_request', 'A project needs at least one admin.', 400);
    }
  } catch (error) {
    return fail('server_error', error instanceof Error ? error.message : 'Could not check admins.', 500);
  }

  const { error } = await auth.supabase
    .from('project_members')
    .update({ role: role as MemberRole })
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
    const currentAdmins = await adminCount(projectId);
    const { data: member } = await auth.supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
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
