import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from '@/types/database';

/** The caller's role on a project, under their own RLS; null when not a member. */
export async function roleOn(supabase: SupabaseClient, projectId: string, userId: string): Promise<MemberRole | null> {
  const { data } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.role as MemberRole | undefined) ?? null;
}
