import type { SupabaseClient } from '@supabase/supabase-js';

export interface DayNeighbour {
  id: string;
  entry_date: string;
  status: string;
}

export interface DayNeighbours {
  prev: DayNeighbour | null;
  next: DayNeighbour | null;
}

/**
 * The day before and the day after, as recorded.
 *
 * "Previous day" means the previous day with an entry on this job, not the
 * previous calendar date — a rest day or a day nobody wrote up has nothing to
 * open. Each day is represented by its current version: a signed day that
 * has been corrected shows the correction, never the superseded original.
 * RLS decides what the caller sees, so a PM and a supervisor get the same
 * neighbours they would find on the Past days list.
 */
export async function loadDayNeighbours(
  supabase: SupabaseClient,
  projectId: string,
  entryDate: string,
): Promise<DayNeighbours> {
  const { data } = await supabase
    .from('entries')
    .select('id, entry_date, status, supersedes_entry_id, created_at')
    .eq('project_id', projectId)
    .neq('entry_date', entryDate)
    .order('entry_date')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as Array<{
    id: string;
    entry_date: string;
    status: string;
    supersedes_entry_id: string | null;
    created_at: string;
  }>;
  const superseded = new Set(rows.map((r) => r.supersedes_entry_id).filter(Boolean));
  const current = rows.filter((r) => !superseded.has(r.id));

  // Newest version per date (rows arrive newest-first within a date).
  const byDate = new Map<string, DayNeighbour>();
  for (const r of current) {
    if (!byDate.has(r.entry_date)) byDate.set(r.entry_date, { id: r.id, entry_date: r.entry_date, status: r.status });
  }
  const dates = [...byDate.keys()].sort();
  const before = dates.filter((d) => d < entryDate);
  const after = dates.filter((d) => d > entryDate);
  return {
    prev: before.length ? byDate.get(before[before.length - 1]) ?? null : null,
    next: after.length ? byDate.get(after[0]) ?? null : null,
  };
}
