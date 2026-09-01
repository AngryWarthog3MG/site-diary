import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The claims register: everything across the project's whole life that a
 * contracts administrator reaches for — delays with time lost, variations
 * with directions and money, dayworks with dockets — each line pointing back
 * at its signed entry. Same transport as every report: fixed SQL through the
 * RLS-scoped, read-only diary RPC. Signed, non-superseded entries only.
 */

export interface ClaimsData {
  project: { id: string; name: string; code: string; orgCode: string };
  entryIds: Record<string, string>;
  delays: {
    rows: Array<{
      date: string;
      entry_no: string;
      cause: string;
      category: string | null;
      duration_mins: number | null;
      personnel_affected: number | null;
    }>;
    totalMinutes: number;
    totalHours: number;
    manHoursLost: number;
    byCategory: Array<{ category: string; hours: number; events: number }>;
  };
  variations: {
    rows: Array<{
      date: string;
      entry_no: string;
      vr_ref: string | null;
      description: string;
      directed_by: string | null;
      estimated_cost: number | null;
    }>;
    totalCost: number;
    unreferenced: number;
  };
  dayworks: {
    rows: Array<{
      date: string;
      entry_no: string;
      description: string;
      docket_ref: string | null;
      hours: number | null;
      labour: string | null;
      plant: string | null;
    }>;
    totalHours: number;
    missingDockets: number;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClaimsLoadError extends Error {}

const num = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

async function diaryQuery(
  supabase: SupabaseClient,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc(
    'run_diary_query',
    { p_sql: sql, p_limit: 1000 },
    { get: true },
  );
  if (error) throw new ClaimsLoadError(`Could not read the diary: ${error.message}`);
  return ((data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []);
}

export async function loadClaimsData(
  supabase: SupabaseClient,
  project: { id: string; name: string; code: string; orgCode: string },
): Promise<ClaimsData> {
  if (!UUID_RE.test(project.id)) throw new ClaimsLoadError('Bad project id.');

  const where = `where project_id = '${project.id}'`;
  const [entries, delays, variations, dayworks] = await Promise.all([
    diaryQuery(supabase, `select entry_no, entry_id from diary.entries ${where}`),
    diaryQuery(
      supabase,
      `select entry_no, entry_date, cause, category, duration_mins, personnel_affected from diary.delays ${where} order by entry_date`,
    ),
    diaryQuery(
      supabase,
      `select entry_no, entry_date, vr_ref, description, directed_by, estimated_cost from diary.variations ${where} order by entry_date`,
    ),
    diaryQuery(
      supabase,
      `select entry_no, entry_date, description, docket_ref, hours, labour, plant from diary.dayworks ${where} order by entry_date`,
    ),
  ]);

  const entryIds: Record<string, string> = {};
  for (const row of entries) entryIds[String(row.entry_no)] = String(row.entry_id);

  const delayRows = delays.map((row) => ({
    date: String(row.entry_date ?? ''),
    entry_no: String(row.entry_no ?? ''),
    cause: String(row.cause ?? ''),
    category: (row.category as string | null) ?? null,
    duration_mins: row.duration_mins == null ? null : num(row.duration_mins),
    personnel_affected: row.personnel_affected == null ? null : num(row.personnel_affected),
  }));
  const totalMinutes = delayRows.reduce((sum, r) => sum + (r.duration_mins ?? 0), 0);
  const manHoursLost = round2(
    delayRows.reduce(
      (sum, r) => sum + ((r.duration_mins ?? 0) / 60) * (r.personnel_affected ?? 0),
      0,
    ),
  );
  const byCat = new Map<string, { minutes: number; events: number }>();
  for (const r of delayRows) {
    const key = (r.category ?? 'uncategorised').trim() || 'uncategorised';
    const bucket = byCat.get(key) ?? { minutes: 0, events: 0 };
    bucket.minutes += r.duration_mins ?? 0;
    bucket.events += 1;
    byCat.set(key, bucket);
  }

  const variationRows = variations.map((row) => ({
    date: String(row.entry_date ?? ''),
    entry_no: String(row.entry_no ?? ''),
    vr_ref: ((row.vr_ref as string | null) ?? '').trim() || null,
    description: String(row.description ?? ''),
    directed_by: (row.directed_by as string | null) ?? null,
    estimated_cost: row.estimated_cost == null ? null : num(row.estimated_cost),
  }));

  const dayworkRows = dayworks.map((row) => ({
    date: String(row.entry_date ?? ''),
    entry_no: String(row.entry_no ?? ''),
    description: String(row.description ?? ''),
    docket_ref: ((row.docket_ref as string | null) ?? '').trim() || null,
    hours: row.hours == null ? null : num(row.hours),
    labour: (row.labour as string | null) ?? null,
    plant: (row.plant as string | null) ?? null,
  }));

  return {
    project,
    entryIds,
    delays: {
      rows: delayRows,
      totalMinutes,
      totalHours: round2(totalMinutes / 60),
      manHoursLost,
      byCategory: [...byCat.entries()]
        .map(([category, v]) => ({ category, hours: round2(v.minutes / 60), events: v.events }))
        .sort((a, b) => b.hours - a.hours),
    },
    variations: {
      rows: variationRows,
      totalCost: round2(variationRows.reduce((sum, r) => sum + (r.estimated_cost ?? 0), 0)),
      unreferenced: variationRows.filter((r) => !r.vr_ref).length,
    },
    dayworks: {
      rows: dayworkRows,
      totalHours: round2(dayworkRows.reduce((sum, r) => sum + (r.hours ?? 0), 0)),
      missingDockets: dayworkRows.filter((r) => !r.docket_ref).length,
    },
  };
}
