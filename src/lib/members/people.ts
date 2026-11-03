import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The job's members with the name on the sheets. By default those who can hold an action (README
 * R177: every role but the labourer, who has no door to the register); `everyone` for a list of
 * people on the job, a form's subject say. Two reads, because `project_members` has no relationship
 * PostgREST can embed to `profiles` — an embed there fails quietly and the list comes back empty
 * (found on the asset, risk and forms pages, 03/11/2026).
 */
export async function loadJobPeople(supabase: SupabaseClient, projectId: string, opts?: { everyone?: boolean }): Promise<Array<{ id: string; name: string }>> {
  const { data: members } = await supabase.from('project_members').select('user_id, role').eq('project_id', projectId);
  const rows = ((members ?? []) as Array<{ user_id: string; role: string }>).filter((m) => opts?.everyone || m.role !== 'labourer');
  if (rows.length === 0) return [];
  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', rows.map((m) => m.user_id));
  const name = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name]));
  return rows.map((m) => ({ id: m.user_id, name: name.get(m.user_id) ?? 'Unnamed' })).sort((a, b) => a.name.localeCompare(b.name));
}
