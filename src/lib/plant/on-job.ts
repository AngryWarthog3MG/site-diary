import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The machines on a job, read from the one register through project_plant.
 * This is what the diary's vocabulary, the review chips and the Plant page's
 * "today" list all share, so a machine added in one place is known everywhere.
 */
export interface PlantOnJob {
  id: string;
  name: string;
  kind: string;
  plant_no: string | null;
  ownership: string;
  supplier: string | null;
  aliases: string[];
  sort_order: number;
}

/** The diary's plant rows carry the old two-word hire type; the register carries ownership. */
export function hireTypeFromOwnership(ownership: string | null | undefined): 'wet' | 'dry' | null {
  if (ownership === 'wet_hire') return 'wet';
  if (ownership === 'dry_hire') return 'dry';
  return null;
}

export async function loadPlantOnJob(supabase: SupabaseClient, projectId: string): Promise<PlantOnJob[]> {
  const { data } = await supabase
    .from('project_plant')
    .select('active, sort_order, plant:plant_register!inner(id, name, kind, plant_no, ownership, supplier, aliases, active)')
    .eq('project_id', projectId)
    .eq('active', true)
    .order('sort_order');
  const out: PlantOnJob[] = [];
  for (const row of data ?? []) {
    const p = (Array.isArray(row.plant) ? row.plant[0] : row.plant) as
      | { id: string; name: string; kind: string; plant_no: string | null; ownership: string; supplier: string | null; aliases: string[] | null; active: boolean }
      | null;
    if (!p || !p.active) continue;
    out.push({ id: p.id, name: p.name, kind: p.kind, plant_no: p.plant_no, ownership: p.ownership, supplier: p.supplier, aliases: p.aliases ?? [], sort_order: (row.sort_order as number) ?? 0 });
  }
  return out.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** The shape applyKnownNames wants: what the extraction should recognise. */
export function asKnownPlant(rows: PlantOnJob[]): Array<{ item: string; hire_type: 'wet' | 'dry' | null; supplier: string | null; aliases: string[] }> {
  return rows.map((p) => ({ item: p.name, hire_type: hireTypeFromOwnership(p.ownership), supplier: p.supplier, aliases: p.aliases }));
}
