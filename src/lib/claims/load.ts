import type { SupabaseClient } from '@supabase/supabase-js';
import { summariseRegister, type RegisterItem, type RegisterSummary } from './register';
import { loadDocketsAdded } from '@/lib/weekly/load';

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
      register_seq: number | null;
      description: string;
      crew: string[];
      hours: number | null;
      estimated_cost: number | null;
      variation_id: string | null;
    }>;
    totalCost: number;
    unreferenced: number;
    /** The register: one item per variation, with the diary days that mention it. */
    register: RegisterItem[];
    summary: RegisterSummary;
    /** Unsigned days on the project, for recording an item on another day. */
    openDays: Array<{ entry_id: string; date: string; author_id: string }>;
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
      daywork_id: string | null;
      docket_added: { ref: string; on: string } | null;
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
      `select entry_no, entry_date, vr_ref, register_seq, description, crew, hours, estimated_cost, variation_id from diary.variations ${where} order by entry_date`,
    ),
    diaryQuery(
      supabase,
      `select entry_no, entry_date, description, docket_ref, hours, labour, plant, daywork_id from diary.dayworks ${where} order by entry_date`,
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
    crew: Array.isArray(row.crew) ? (row.crew as string[]) : [],
    register_seq: row.register_seq == null ? null : Number(row.register_seq),
    hours: row.hours == null ? null : num(row.hours),
    estimated_cost: row.estimated_cost == null ? null : num(row.estimated_cost),
    variation_id: (row.variation_id as string | null) ?? null,
  }));

  // The register beside the diary: which item each mention belongs to, and
  // where each item stands. Read under RLS like everything else here.
  const register = await loadRegister(supabase, project.id);
  const { data: open } = await supabase
    .from('entries')
    .select('id, entry_date, author_id')
    .eq('project_id', project.id)
    .neq('status', 'signed')
    .order('entry_date');
  const openDays = ((open ?? []) as Array<{ id: string; entry_date: string; author_id: string }>).map((e) => ({
    entry_id: e.id, date: e.entry_date, author_id: e.author_id,
  }));

  const added = await loadDocketsAdded(supabase, dayworks);
  const dayworkRows = dayworks.map((row) => {
    const ref = ((row.docket_ref as string | null) ?? '').trim() || null;
    const id = (row.daywork_id as string | null) ?? null;
    return {
      date: String(row.entry_date ?? ''),
      entry_no: String(row.entry_no ?? ''),
      description: String(row.description ?? ''),
      docket_ref: ref,
      hours: row.hours == null ? null : num(row.hours),
      labour: (row.labour as string | null) ?? null,
      plant: (row.plant as string | null) ?? null,
      daywork_id: id,
      docket_added: ref || !id ? null : (added.get(id) ?? null),
    };
  });

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
      unreferenced: variationRows.filter((r) => r.register_seq == null).length,
      register,
      summary: summariseRegister(register),
      openDays,
    },
    dayworks: {
      rows: dayworkRows,
      totalHours: round2(dayworkRows.reduce((sum, r) => sum + (r.hours ?? 0), 0)),
      missingDockets: dayworkRows.filter((r) => !r.docket_ref && !r.docket_added).length,
    },
  };
}

async function loadRegister(supabase: SupabaseClient, projectId: string): Promise<RegisterItem[]> {
  // Every item on the project, then every diary row that mentions one — draft
  // or signed — so a variation dictated this afternoon is already here.
  const [{ data: items }, { data: links }] = await Promise.all([
    supabase
      .from('variation_register')
      .select('id, seq, title, vr_ref, raised_on, status, estimated_cost, agreed_cost, submitted_on, decided_on, paid_on, notes')
      .eq('project_id', projectId),
    supabase
      .from('variation_register_links')
      .select('register_id, variation:variations(id, crew, hours, entry:entries!inner(id, entry_no, entry_date, status, project_id))')
      .eq('variation.entry.project_id', projectId),
  ]);
  const out = new Map<string, RegisterItem>();
  for (const row of (items ?? []) as Array<Omit<RegisterItem, 'mentions' | 'signed'>>) {
    out.set(row.id, {
      ...row,
      estimated_cost: row.estimated_cost == null ? null : num(row.estimated_cost),
      agreed_cost: row.agreed_cost == null ? null : num(row.agreed_cost),
      mentions: [],
      crew: [],
      hours: 0,
      signed: false,
    });
  }
  type LinkRow = { register_id: string; variation: { id: string; crew: string[] | null; hours: number | string | null; entry: { id: string; entry_no: string | null; entry_date: string; status: string } | Array<{ id: string; entry_no: string | null; entry_date: string; status: string }> } | null };
  for (const link of (links ?? []) as unknown as LinkRow[]) {
    const item = out.get(link.register_id);
    const variation = Array.isArray(link.variation) ? link.variation[0] : link.variation;
    const entry = variation ? (Array.isArray(variation.entry) ? variation.entry[0] : variation.entry) : null;
    if (!item || !entry) continue;
    const signed = entry.status === 'signed';
    item.mentions.push({ date: entry.entry_date, entry_no: signed ? entry.entry_no : null, entry_id: entry.id, signed });
    for (const n of variation.crew ?? []) if (!item.crew.some((c) => c.toLowerCase() === n.toLowerCase())) item.crew.push(n);
    if (variation.hours != null) item.hours = Math.round((item.hours + num(variation.hours)) * 100) / 100;
    if (signed) item.signed = true;
  }
  return [...out.values()]
    .map((item) => ({ ...item, mentions: item.mentions.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.seq - b.seq);
}
