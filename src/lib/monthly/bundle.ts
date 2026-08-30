import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The monthly bundle: every signed docket for one calendar month, stitched
 * into a single PDF behind a cover index — the month's diary as one document
 * for the head-contract record.
 *
 * Superseded entries are included, marked as such on the cover. A correction
 * does not erase the entry it corrects — both are signed, both immutable,
 * and an archive that quietly dropped one would be editing the record.
 */

export interface MonthEntry {
  id: string;
  entry_no: string;
  entry_date: string;
  signed_at: string | null;
  content_hash: string | null;
  author_name: string;
  superseded_by: string | null;
}

export interface MonthData {
  project: { id: string; name: string; code: string; orgCode: string };
  month: string; // YYYY-MM
  start: string;
  end: string;
  entries: MonthEntry[];
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MonthlyLoadError extends Error {}

/** First and last day of a YYYY-MM month, computed in UTC. */
export function monthRange(month: string): { start: string; end: string } {
  if (!MONTH_RE.test(month)) throw new MonthlyLoadError('month must be YYYY-MM.');
  const [year, mm] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * All signed entries in the month, oldest first, under the caller's RLS.
 * The superseded-by relationship is resolved within the whole project, not
 * just the month — a September correction still marks an August entry.
 */
export async function loadMonthEntries(
  supabase: SupabaseClient,
  projectId: string,
  month: string,
): Promise<MonthEntry[]> {
  const { start, end } = monthRange(month);

  const [{ data: rows, error }, { data: supersessions, error: supError }] = await Promise.all([
    supabase
      .from('entries')
      .select(
        'id, entry_no, entry_date, signed_at, content_hash, author:profiles!entries_author_profiles_fkey(full_name, email)',
      )
      .eq('project_id', projectId)
      .eq('status', 'signed')
      .gte('entry_date', start)
      .lte('entry_date', end)
      .order('entry_date')
      .order('signed_at'),
    supabase
      .from('entries')
      .select('entry_no, supersedes_entry_id')
      .eq('project_id', projectId)
      .eq('status', 'signed')
      .not('supersedes_entry_id', 'is', null),
  ]);
  if (error) throw new MonthlyLoadError(`Could not load the month: ${error.message}`);
  if (supError) throw new MonthlyLoadError(`Could not load corrections: ${supError.message}`);

  const supersededBy = new Map<string, string>();
  for (const row of supersessions ?? []) {
    if (row.supersedes_entry_id) supersededBy.set(row.supersedes_entry_id, row.entry_no as string);
  }

  return (rows ?? []).map((row) => {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    return {
      id: row.id as string,
      entry_no: row.entry_no as string,
      entry_date: row.entry_date as string,
      signed_at: (row.signed_at as string | null) ?? null,
      content_hash: (row.content_hash as string | null) ?? null,
      author_name:
        (author?.full_name as string | null) ?? (author?.email as string | null) ?? 'Unknown',
      superseded_by: supersededBy.get(row.id as string) ?? null,
    };
  });
}
