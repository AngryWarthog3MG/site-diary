import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Closing and reopening an account (README R115). "Delete the account when
 * they're removed from their last job."
 *
 * Not a delete, and on purpose. The account's id is on the record: every
 * incident they reported, ticket they recorded, docket they signed carries it
 * with `on delete no action`, so the database refuses to delete anyone who has
 * ever recorded anything — and where it would not refuse, it would cascade
 * through their profile and take the name off the sheets. So the account is
 * CLOSED: banned in the auth service (no link, no code, no refresh), its
 * profile and its record kept exactly as they were, with a line in the access
 * history saying when and by whom. Adding the person to a job again reopens it.
 *
 * A ban stops the next sign-in and the next token refresh. A phone already
 * signed in keeps its access token until it expires (twelve hours); with no
 * membership left, RLS shows it nothing in the meantime.
 */

/** Long enough to be "closed" without pretending to be a date. */
const CLOSED_FOR = '876000h'; // one hundred years

export interface AccountChange {
  /** What happened, for the caller's log line. */
  outcome: 'closed' | 'reopened' | 'left_open' | 'not_closed';
  /** Where the person still holds a job, when the account stays open. */
  remaining?: number;
}

/** A person with no job left on any project has their account closed. */
export async function closeAccountIfOrphaned(
  admin: SupabaseClient,
  userId: string,
  by: { projectId: string; changedBy: string; wasRole: string | null },
): Promise<AccountChange> {
  const { count } = await admin.from('project_members').select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
  if ((count ?? 0) > 0) return { outcome: 'left_open', remaining: count ?? 0 };

  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: CLOSED_FOR });
  if (error) throw new Error(`Could not close the account: ${error.message}`);
  await admin.from('member_access_events').insert({
    project_id: by.projectId, user_id: userId, kind: 'account_closed',
    old_role: by.wasRole, new_role: null, money_before: false, money_after: false, changed_by: by.changedBy,
  });
  return { outcome: 'closed' };
}

/** A closed account that is being put back on a job opens again. */
export async function reopenAccount(
  admin: SupabaseClient,
  userId: string,
  by: { projectId: string; changedBy: string; newRole: string },
): Promise<AccountChange> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error(`Could not read the account: ${error?.message ?? 'not found'}`);
  if (!isClosed(data.user)) return { outcome: 'left_open' };

  const { error: uErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (uErr) throw new Error(`Could not reopen the account: ${uErr.message}`);
  await admin.from('member_access_events').insert({
    project_id: by.projectId, user_id: userId, kind: 'account_reopened',
    old_role: null, new_role: by.newRole, money_before: false, money_after: false, changed_by: by.changedBy,
  });
  return { outcome: 'reopened' };
}

/** Banned into the future = closed. */
export function isClosed(user: { banned_until?: string | null }): boolean {
  return bannedUntilIsFuture(user.banned_until ?? null, new Date());
}

export function bannedUntilIsFuture(bannedUntil: string | null, now: Date): boolean {
  if (!bannedUntil) return false;
  const t = Date.parse(bannedUntil);
  return Number.isFinite(t) && t > now.getTime();
}
