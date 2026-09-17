import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDocketsAdded } from '@/lib/weekly/load';
import { buildSchedule, type DayworkLine, type DayworksSchedule, type Range } from './schedule';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DayworksScheduleData extends DayworksSchedule {
  /** The diary query is capped at 1,000 rows; true when the period reached it, so totals may be short. */
  truncated: boolean;
  /** Dayworks on days not yet signed in the period — not in the schedule, which is the signed record. */
  unsignedItems: number;
  unsignedDays: number;
}

async function diaryQuery(supabase: SupabaseClient, sql: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc('run_diary_query', { p_sql: sql, p_limit: 1000 }, { get: true });
  if (error) throw new Error(`Could not read the diary: ${error.message}`);
  return ((data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []);
}

/**
 * The schedule for a job and period, under the caller's RLS. Read from
 * diary.dayworks — signed days only, a corrected day counted once — with
 * dockets added after signing, exactly as the claims register reads them.
 */
export async function loadDayworksSchedule(supabase: SupabaseClient, projectId: string, range: Pick<Range, 'from' | 'to'>): Promise<DayworksScheduleData> {
  if (!UUID_RE.test(projectId)) throw new Error('Bad project id.');
  if ((range.from && !DATE_RE.test(range.from)) || (range.to && !DATE_RE.test(range.to))) throw new Error('Bad date.');
  const where = [`project_id = '${projectId}'`, range.from ? `entry_date >= '${range.from}'` : null, range.to ? `entry_date <= '${range.to}'` : null].filter(Boolean).join(' and ');

  let unsigned = supabase
    .from('dayworks')
    .select('id, entry:entries!inner(entry_date, status, project_id)')
    .eq('entry.project_id', projectId)
    .neq('entry.status', 'signed');
  if (range.from) unsigned = unsigned.gte('entry.entry_date', range.from);
  if (range.to) unsigned = unsigned.lte('entry.entry_date', range.to);

  const [rows, entries, { data: open, error: openError }] = await Promise.all([
    diaryQuery(supabase, `select entry_no, entry_date, description, labour, plant, materials, hours, docket_ref, daywork_id from diary.dayworks where ${where} order by entry_date`),
    diaryQuery(supabase, `select entry_no, entry_id from diary.entries where ${where}`),
    unsigned,
  ]);
  if (openError) throw new Error(`Could not check unsigned days: ${openError.message}`);

  const entryIds = new Map(entries.map((e) => [String(e.entry_no), String(e.entry_id)]));
  const added = await loadDocketsAdded(supabase, rows);
  const lines: DayworkLine[] = rows.map((row) => {
    const ref = ((row.docket_ref as string | null) ?? '').trim() || null;
    const id = (row.daywork_id as string | null) ?? null;
    const late = !ref && id ? added.get(id) ?? null : null;
    const hours = row.hours == null ? null : Number(row.hours);
    return {
      date: String(row.entry_date),
      entryNo: String(row.entry_no),
      entryId: entryIds.get(String(row.entry_no)) ?? null,
      works: String(row.description ?? ''),
      labour: ((row.labour as string | null) ?? '').trim() || null,
      plant: ((row.plant as string | null) ?? '').trim() || null,
      materials: ((row.materials as string | null) ?? '').trim() || null,
      hours: hours != null && Number.isFinite(hours) ? hours : null,
      docket: ref ?? late?.ref ?? null,
      docketAddedOn: late?.on ?? null,
    };
  });

  type OpenRow = { id: string; entry: { entry_date: string } | Array<{ entry_date: string }> };
  const openRows = (open ?? []) as unknown as OpenRow[];
  const openDays = new Set(openRows.map((r) => (Array.isArray(r.entry) ? r.entry[0]?.entry_date : r.entry?.entry_date)).filter(Boolean));

  return { ...buildSchedule(lines, range), truncated: rows.length >= 1000, unsignedItems: openRows.length, unsignedDays: openDays.size };
}
