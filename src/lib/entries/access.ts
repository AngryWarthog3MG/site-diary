import type { SupabaseClient } from '@supabase/supabase-js';
import { canAuthorEntries } from '@/lib/roles';
import type { MemberRole } from '@/types/database';

/**
 * Who may work on an unsigned entry: its author, or anyone holding an
 * authoring role (supervisor, admin) on that job. Mirrors
 * `app.can_write_entry` in SQL — the database is the gate; this is the
 * app's early, readable answer. Binning a draft is not covered: that stays
 * with the author.
 */
export async function canEditEntry(
  supabase: SupabaseClient,
  userId: string,
  entry: { author_id: string; project_id: string },
): Promise<boolean> {
  if (entry.author_id === userId) return true;
  const { data } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', entry.project_id)
    .eq('user_id', userId)
    .maybeSingle();
  return data ? canAuthorEntries(data.role as MemberRole) : false;
}
