import type { SupabaseClient } from '@supabase/supabase-js';

export interface SitePlan { title: string; revision: string | null; receivedOn: string; url: string | null }

/**
 * The head contractor's emergency plan in force on this job, as received — readable by every member,
 * a labourer included (reg. 43; README R78) — with a signed link to its copy when one was kept.
 */
export async function loadHeadContractorEmergencyPlan(supabase: SupabaseClient, projectId: string): Promise<SitePlan | null> {
  const { data } = await supabase
    .from('head_contractor_documents')
    .select('title, revision, received_on, file_path, created_at')
    .eq('project_id', projectId)
    .eq('kind', 'emergency_plan')
    .is('superseded_by', null)
    .order('received_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  let url: string | null = null;
  if (data.file_path) {
    const { data: link } = await supabase.storage.from('head-contractor-docs').createSignedUrl(data.file_path as string, 3600);
    url = link?.signedUrl ?? null;
  }
  return { title: data.title as string, revision: (data.revision as string | null) ?? null, receivedOn: data.received_on as string, url };
}
