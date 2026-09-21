import type { SupabaseClient } from '@supabase/supabase-js';
import { summarise } from './model';

/** What the home card says about the job's setup board (README R92). Office only — the caller checks the screen. */
export interface SetupCard {
  /** Modules attached, so the job has been stamped at least once. */
  setUp: boolean;
  /** Active items in the company's library — a job not yet set up is only worth a nudge when there is something to stamp. */
  libraryItems: number;
  openStartGate: number;
  priorityAOpen: number;
  overdue: number;
  documentGaps: number;
  percent: number | null;
}

export async function loadSetupCard(supabase: SupabaseClient, projectId: string, orgId: string, today: string): Promise<SetupCard> {
  const [mods, items, lib] = await Promise.all([
    supabase.from('project_modules').select('module_key', { count: 'exact', head: true }).eq('project_id', projectId),
    supabase.from('project_setup_items').select('kind, status, priority, due_on, category').eq('project_id', projectId),
    supabase.from('template_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('active', true),
  ]);
  const s = summarise((items.data ?? []) as Parameters<typeof summarise>[0], today);
  return {
    setUp: (mods.count ?? 0) > 0,
    libraryItems: lib.count ?? 0,
    openStartGate: s.byKind.start_gate.open,
    priorityAOpen: s.priorityAOpen,
    overdue: s.overdue,
    documentGaps: s.documentGaps,
    percent: s.startGate.percent,
  };
}
