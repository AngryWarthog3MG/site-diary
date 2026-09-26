import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { seesMoney } from '@/lib/roles';
import type { MemberRole } from '@/types/database';

/**
 * Reset someone's two-factor sign-in after a lost phone (README R106). An admin of this job, with their own code
 * entered, for someone else on this job. Every authenticator on the account is removed, which also signs them out
 * everywhere; they set it up again under Security. Kept in the job's access history.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { data: me } = await supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (me?.role !== 'admin') return fail('forbidden', 'Only an admin of this job can reset two-factor sign-in.', 403);
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== 'aal2') return fail('forbidden', 'Resetting someone’s two-factor needs your own code. Enter it under Security, then try again.', 403);

  const body = await readJson(request);
  const userId = body?.userId;
  if (!isUuid(userId)) return fail('bad_request', 'Bad user id.', 400);
  if (userId === user.id) return fail('bad_request', 'You cannot reset your own — turn it off under Security, or ask another admin.', 400);
  const { data: member } = await supabase.from('project_members').select('role, finance').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (!member) return fail('not_found', 'That person is not on this job.', 404);

  const admin = createAdminClient();
  const { data: factors, error: lErr } = await admin.auth.admin.mfa.listFactors({ userId });
  if (lErr) return fail('server_error', lErr.message, 500);
  const list = (factors?.factors ?? []) as Array<{ id: string }>;
  if (list.length === 0) return ok({ message: 'They have no two-factor set up — nothing to reset.' });
  for (const f of list) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    if (error) return fail('server_error', `Could not reset it: ${error.message}`, 500);
  }
  const money = seesMoney({ role: member.role as MemberRole, finance: (member.finance as boolean | null) ?? null });
  await admin.from('member_access_events').insert({
    project_id: projectId, user_id: userId, kind: 'two_factor_reset', old_role: member.role, new_role: member.role,
    old_finance: member.finance, new_finance: member.finance, money_before: money, money_after: money, changed_by: user.id,
  });
  return ok({ message: 'Two-factor reset. They are signed out everywhere and set it up again under Security.' });
}
