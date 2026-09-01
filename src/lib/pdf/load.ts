import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Loading an entry for the daily PDF.
 *
 * Two rules, both in service of §2.3 — regenerating the same entry a year
 * later must produce a byte-identical document:
 *
 *   * Every list is ordered by its own content, not by id. Row ids are random
 *     uuids; ordering by them would be stable within one database and
 *     meaningless across a restore. Ordering by content is the same approach
 *     the content hash takes.
 *   * Nothing derived, nothing formatted, nothing inferred happens here. The
 *     template renders stored fields and only stored fields.
 */

export interface DocketEntry {
  id: string;
  entry_no: string | null;
  entry_date: string;
  status: string;
  signed_at: string | null;
  content_hash: string | null;
  supersedes_entry_id: string | null;
  supersedes_entry_no: string | null;
  notes: string | null;

  project_id: string;
  org_name: string;
  org_code: string;
  project_name: string;
  project_code: string;
  principal_contractor: string | null;

  author_name: string;

  labour: Row[];
  plant: Row[];
  work_items: Row[];
  variations: Row[];
  delays: Row[];
  pours: Row[];
  quantities: Row[];
  dayworks: Row[];
  photos: Row[];
  weather: Row | null;
  sections: Record<string, { state: string; note: string | null }>;
}

export type Row = Record<string, unknown>;

/** Ignore storage bookkeeping when ordering; it is not part of the record. */
const NOT_CONTENT = new Set(['id', 'entry_id', 'created_at']);

function canonicalKey(row: Row): string {
  return JSON.stringify(
    Object.keys(row)
      .filter((key) => !NOT_CONTENT.has(key))
      .sort()
      .map((key) => [key, row[key]]),
  );
}

export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b)));
}

function first(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  return (value as Row | null) ?? null;
}

export async function loadDocketEntry(
  supabase: SupabaseClient,
  entryId: string,
): Promise<DocketEntry | null> {
  const { data } = await supabase
    .from('entries')
    .select(
      `id, entry_no, entry_date, status, signed_at, content_hash, supersedes_entry_id, notes,
       project_id, author_id,
       project:projects!inner(name, code, principal_contractor,
                              org:organisations!inner(name, code)),
       labour(*), plant(*), work_items(*), variations(*), delays(*), pours(*),
       quantities(*), dayworks(*), photos(*), weather(*), entry_sections(*)`,
    )
    .eq('id', entryId)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as Row;
  const project = first(row.project) as Row | null;
  const org = first(project?.org) as Row | null;
  // Separate fetch kept for stability; since 20260902090200 an embedded join
  // via entries_author_profiles_fkey also works.
  const { data: author } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', row.author_id as string)
    .maybeSingle();

  let supersededNo: string | null = null;
  if (row.supersedes_entry_id) {
    const { data: prior } = await supabase
      .from('entries')
      .select('entry_no')
      .eq('id', row.supersedes_entry_id as string)
      .maybeSingle();
    supersededNo = (prior?.entry_no as string | null) ?? null;
  }

  const sections: DocketEntry['sections'] = {};
  for (const section of (row.entry_sections as Row[] | null) ?? []) {
    sections[section.section as string] = {
      state: section.state as string,
      note: (section.note as string | null) ?? null,
    };
  }

  const list = (key: string) => sortRows(((row[key] as Row[] | null) ?? []));

  return {
    id: row.id as string,
    entry_no: (row.entry_no as string | null) ?? null,
    entry_date: row.entry_date as string,
    status: row.status as string,
    signed_at: (row.signed_at as string | null) ?? null,
    content_hash: (row.content_hash as string | null) ?? null,
    supersedes_entry_id: (row.supersedes_entry_id as string | null) ?? null,
    supersedes_entry_no: supersededNo,
    notes: (row.notes as string | null) ?? null,

    project_id: row.project_id as string,
    org_name: (org?.name as string) ?? '',
    org_code: (org?.code as string) ?? '',
    project_name: (project?.name as string) ?? '',
    project_code: (project?.code as string) ?? '',
    principal_contractor: (project?.principal_contractor as string | null) ?? null,

    author_name:
      (author?.full_name as string | null) ?? (author?.email as string | null) ?? 'Unknown',

    labour: list('labour'),
    plant: list('plant'),
    work_items: list('work_items'),
    variations: list('variations'),
    delays: list('delays'),
    pours: list('pours'),
    quantities: list('quantities'),
    dayworks: list('dayworks'),
    photos: list('photos'),
    weather: first(row.weather),
    sections,
  };
}

/**
 * A stored timestamp, printed as an unambiguous UTC instant.
 *
 * Deliberately not `toLocaleString`. Locale formatting depends on the ICU data
 * built into whatever runtime happens to render the document, which is exactly
 * the sort of thing that changes underneath you and breaks byte-identical
 * regeneration. This is pure string work on the value Postgres returned, and a
 * UTC instant is what a legal record wants anyway — `entry_date` already
 * carries the site's own local day.
 */
export function formatInstant(value: string | null): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, y, mo, d, h, mi, s] = match;

  // Postgres returns timestamptz with an offset; normalise to UTC by hand.
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(value);
  let minutes =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 60000;
  if (offset) {
    const sign = offset[1] === '-' ? 1 : -1;
    minutes += sign * (Number(offset[2]) * 60 + Number(offset[3]));
  } else if (!/Z$/.test(value)) {
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  }

  // Site time: AWST is UTC+8 with no daylight saving, ever — a fixed shift,
  // so the render stays deterministic with no timezone database involved.
  const at = new Date((minutes + 480) * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} AWST`
  );
}

/** Numbers print at a fixed scale so the same value never renders two ways. */
export function num(value: unknown, digits = 2): string {
  if (value == null || value === '') return '—';
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—';
}

export function text(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? '—' : trimmed;
}

export function timeOnly(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—';
  return value.slice(0, 5);
}
