import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobFeature } from './nav';

/**
 * What a job has that most jobs do not (README R190) — the sections the menu draws only where they exist. A job has a
 * watering register once it has an area on it. Read under the caller's RLS and never allowed to fail the page: a
 * table that cannot be read is a feature the menu leaves out.
 */
export async function jobFeatures(supabase: SupabaseClient, projectId: string): Promise<JobFeature[]> {
  try {
    const { data, error } = await supabase.from('watering_areas').select('id').eq('project_id', projectId).limit(1);
    if (!error && data && data.length > 0) return ['watering'];
  } catch { /* the menu goes without */ }
  return [];
}
