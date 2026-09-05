import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The weekly report's data (brief §6).
 *
 * Everything here is read through `run_diary_query`, the same RLS-scoped,
 * read-only RPC the query layer uses — so the weekly report can only ever see
 * signed, non-superseded entries on projects the caller belongs to. The SQL is
 * fixed and hand-written; nothing model-generated runs here.
 *
 * The aggregation itself is pure functions over the fetched rows, exported
 * individually so the unit tests can drive them without a database.
 */

export interface WeeklyEntryRow {
  entry_no: string;
  entry_date: string;
  author_name: string | null;
  signed_at: string | null;
  notes: string | null;
  /** False for a day still being worked on, whose figures can still change. */
  signed: boolean;
}

export interface LabourPerson {
  name: string;
  role: string | null;
  byDay: Record<string, number>;
  hours: number;
  overtime: number;
  total: number;
}

export interface WeeklyData {
  project: { id: string; name: string; code: string; orgCode: string };
  start: string;
  end: string;
  days: string[];
  entries: WeeklyEntryRow[];
  labour: {
    people: LabourPerson[];
    dayTotals: Record<string, number>;
    grandTotal: number;
    overtimeTotal: number;
  };
  plant: {
    rows: Array<{
      item: string;
      supplier: string | null;
      hire_type: string | null;
      hours: number;
      idle: number;
    }>;
    totalHours: number;
    totalIdle: number;
  };
  pours: {
    rows: Array<{
      date: string;
      entry_no: string;
      location: string | null;
      volume_m3: number | null;
      mix_spec: string | null;
      supplier: string | null;
      cumulative: number;
    }>;
    totalVolume: number;
  };
  workItems: {
    rows: Array<{
      date: string;
      entry_no: string;
      area: string | null;
      description: string;
      percent_complete: number | null;
    }>;
  };
  dayworks: {
    rows: Array<{
      date: string;
      entry_no: string;
      description: string;
      labour: string | null;
      plant: string | null;
      materials: string | null;
      hours: number | null;
      docket_ref: string | null;
    }>;
    totalHours: number;
    unreferenced: number;
  };
  quantities: {
    rows: Array<{
      item_type: string;
      unit: string | null;
      date: string;
      entry_no: string;
      area: string | null;
      quantity: number | null;
      running: number;
    }>;
  };
  delays: {
    rows: Array<{
      date: string;
      entry_no: string;
      cause: string;
      category: string | null;
      start_time: string | null;
      end_time: string | null;
      duration_mins: number | null;
      personnel_affected: number | null;
    }>;
    byCategory: Array<{ category: string; minutes: number; hours: number }>;
    totalMinutes: number;
    totalHours: number;
  };
  weather: {
    rows: Array<{
      date: string;
      temp_min: number | null;
      temp_max: number | null;
      rainfall_mm: number | null;
      wind_dir: string | null;
      wind_kmh: number | null;
      impact: string | null;
    }>;
    totalRainfallMm: number;
    /** The gauge the site's day rows came from, when any were used. */
    station: string | null;
  };
  variations: {
    rows: Array<{
      date: string;
      entry_no: string;
      description: string;
      directed_by: string | null;
      vr_ref: string | null;
      estimated_cost: number | null;
      referenced: boolean;
    }>;
    unreferenced: number;
  };
  /**
   * Days in the range that are recorded but not yet signed. Their figures
   * are in the totals; this is what says so on the page.
   */
  unsigned: { days: string[]; entryCount: number };
  counts: {
    daysInRange: number;
    daysWithEntries: number;
    daysWithoutEntries: number;
    entryCount: number;
    peopleCount: number;
    pourCount: number;
    dayworkCount: number;
    delayCount: number;
    variationCount: number;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A "week" can stretch to a fortnight or a month view, but not beyond. */
export const MAX_RANGE_DAYS = 31;

export class WeeklyLoadError extends Error {}

/** Every date in [start, end], inclusive — computed in UTC so no DST cliff. */
export function datesInRange(start: string, end: string): string[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const days: string[] = [];
  for (let t = from; t <= to && days.length <= MAX_RANGE_DAYS; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

const num = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Labour matrix: person × day, with row, column and grand totals. */
export function aggregateLabour(
  rows: Array<Record<string, unknown>>,
  days: string[],
): WeeklyData['labour'] {
  const byPerson = new Map<string, LabourPerson>();
  for (const row of rows) {
    const name = String(row.person_name ?? '').trim();
    if (!name) continue;
    const person = byPerson.get(name) ?? {
      name,
      role: (row.role as string | null) ?? null,
      byDay: {},
      hours: 0,
      overtime: 0,
      total: 0,
    };
    const date = String(row.entry_date ?? '');
    const hours = num(row.hours);
    const overtime = num(row.overtime_hours);
    person.byDay[date] = round2((person.byDay[date] ?? 0) + hours + overtime);
    person.hours = round2(person.hours + hours);
    person.overtime = round2(person.overtime + overtime);
    person.total = round2(person.total + hours + overtime);
    person.role ??= (row.role as string | null) ?? null;
    byPerson.set(name, person);
  }

  const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  const dayTotals: Record<string, number> = {};
  for (const day of days) {
    const total = people.reduce((sum, p) => sum + (p.byDay[day] ?? 0), 0);
    if (total > 0) dayTotals[day] = round2(total);
  }
  return {
    people,
    dayTotals,
    grandTotal: round2(people.reduce((sum, p) => sum + p.total, 0)),
    overtimeTotal: round2(people.reduce((sum, p) => sum + p.overtime, 0)),
  };
}

/** Plant grouped by item + supplier + hire type, idle time carried through. */
export function aggregatePlant(rows: Array<Record<string, unknown>>): WeeklyData['plant'] {
  const grouped = new Map<string, WeeklyData['plant']['rows'][number]>();
  for (const row of rows) {
    const item = String(row.item ?? '').trim();
    if (!item) continue;
    const supplier = (row.supplier as string | null) ?? null;
    const hire = (row.hire_type as string | null) ?? null;
    // Grouped by the machine, spelling-blind: "1.8t Excavator" and
    // "1.8t excavator" are one line across the week, and a day that left
    // the hire type or supplier blank does not split it off from the days
    // that filled them in. Rows arrive in date order, so the latest day's
    // labels are the ones printed.
    const key = item.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const entry = grouped.get(key) ?? { item, supplier, hire_type: hire, hours: 0, idle: 0 };
    entry.item = item;
    if (supplier) entry.supplier = supplier;
    if (hire) entry.hire_type = hire;
    entry.hours = round2(entry.hours + num(row.hours));
    entry.idle = round2(entry.idle + num(row.idle_hours));
    grouped.set(key, entry);
  }
  const out = [...grouped.values()].sort((a, b) => a.item.localeCompare(b.item));
  return {
    rows: out,
    totalHours: round2(out.reduce((sum, r) => sum + r.hours, 0)),
    totalIdle: round2(out.reduce((sum, r) => sum + r.idle, 0)),
  };
}

/** Pour schedule in date order with a cumulative running total (§6). */
export function aggregatePours(rows: Array<Record<string, unknown>>): WeeklyData['pours'] {
  let cumulative = 0;
  const out = rows
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
    .map((row) => {
      const volume = row.volume_m3 == null ? null : num(row.volume_m3);
      cumulative = round2(cumulative + (volume ?? 0));
      return {
        date: String(row.entry_date ?? ''),
        entry_no: String(row.entry_no ?? ''),
        location: (row.location as string | null) ?? null,
        volume_m3: volume,
        mix_spec: (row.mix_spec as string | null) ?? null,
        supplier: (row.supplier as string | null) ?? null,
        cumulative,
      };
    });
  return { rows: out, totalVolume: cumulative };
}

/**
 * Quantities by item type with running totals. The running total accumulates
 * within an item type AND unit — 40 m of pipe and 3 t of steel never sum, and
 * neither do metres and millimetres of the same item.
 */
export function aggregateQuantities(
  rows: Array<Record<string, unknown>>,
): WeeklyData['quantities'] {
  const running = new Map<string, number>();
  const out = rows
    .slice()
    .sort(
      (a, b) =>
        String(a.item_type ?? '').localeCompare(String(b.item_type ?? '')) ||
        String(a.entry_date).localeCompare(String(b.entry_date)),
    )
    .map((row) => {
      const itemType = String(row.item_type ?? '').trim();
      const unit = (row.unit as string | null) ?? null;
      const quantity = row.quantity == null ? null : num(row.quantity);
      const key = `${itemType}\u0000${unit ?? ''}`;
      const total = round2((running.get(key) ?? 0) + (quantity ?? 0));
      running.set(key, total);
      return {
        item_type: itemType,
        unit,
        date: String(row.entry_date ?? ''),
        entry_no: String(row.entry_no ?? ''),
        area: (row.area as string | null) ?? null,
        quantity,
        running: total,
      };
    });
  return { rows: out };
}

/** Standdown time in the period, totalled by category (§6). */
export function aggregateDelays(rows: Array<Record<string, unknown>>): WeeklyData['delays'] {
  const byCategory = new Map<string, number>();
  const out = rows
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
    .map((row) => {
      const minutes = row.duration_mins == null ? null : num(row.duration_mins);
      const category = ((row.category as string | null) ?? 'uncategorised').trim() || 'uncategorised';
      if (minutes != null) byCategory.set(category, (byCategory.get(category) ?? 0) + minutes);
      return {
        date: String(row.entry_date ?? ''),
        entry_no: String(row.entry_no ?? ''),
        cause: String(row.cause ?? ''),
        category: (row.category as string | null) ?? null,
        start_time: (row.start_time as string | null) ?? null,
        end_time: (row.end_time as string | null) ?? null,
        duration_mins: minutes,
        personnel_affected: row.personnel_affected == null ? null : num(row.personnel_affected),
      };
    });
  const categories = [...byCategory.entries()]
    .map(([category, minutes]) => ({ category, minutes, hours: round2(minutes / 60) }))
    .sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = categories.reduce((sum, c) => sum + c.minutes, 0);
  return { rows: out, byCategory: categories, totalMinutes, totalHours: round2(totalMinutes / 60) };
}

/**
 * One weather row per day, from the best source for each field.
 *
 * A reading the supervisor typed into that day's diary comes first — they were
 * on site, the gauge was not. Otherwise the site's day row (the Bureau's
 * settled figure, kept whether or not a diary was written) with any gap filled
 * from what the diary's own fetch saw. The observed impact is always the
 * supervisor's. Wind stays a pair: a direction from one reading against a
 * speed from another describes nothing.
 */
export function mergeWeatherDays(
  entryRows: Array<Record<string, unknown>>,
  dayRows: Array<Record<string, unknown>>,
  days: readonly string[],
): Array<Record<string, unknown>> {
  const hasNumber = (r: Record<string, unknown>) =>
    [r.temp_min, r.temp_max, r.rainfall_mm, r.wind_kmh].some((v) => v != null);
  const byDate = new Map<string, Record<string, unknown>>();
  for (const r of entryRows) {
    const date = String(r.entry_date ?? '');
    const have = byDate.get(date);
    // A typed reading beats a fetched one for the same day; otherwise first wins.
    if (!have || (r.source === 'manual' && have.source !== 'manual' && hasNumber(r))) byDate.set(date, r);
  }
  const dayByDate = new Map<string, Record<string, unknown>>();
  for (const r of dayRows) dayByDate.set(String(r.day ?? ''), r);

  const out: Array<Record<string, unknown>> = [];
  for (const date of days) {
    const own = byDate.get(date);
    const site = dayByDate.get(date);
    if (!own && !site) continue;
    if (own && own.source === 'manual' && hasNumber(own)) {
      out.push({ ...own, entry_date: date });
      continue;
    }
    if (!site) {
      out.push({ ...own, entry_date: date });
      continue;
    }
    if (site.source !== 'bom_daily') {
      // Both are running observations of the same gauge, fetched at different
      // times: the maximum and the rain total only ever rise, the minimum is
      // the same overnight window, and the diary's wind is the later look.
      out.push({
        entry_date: date,
        temp_min: pickNum(site.temp_min, own?.temp_min, Math.min),
        temp_max: pickNum(site.temp_max, own?.temp_max, Math.max),
        rainfall_mm: pickNum(site.rainfall_mm, own?.rainfall_mm, Math.max),
        wind_dir: own?.wind_kmh != null ? own.wind_dir ?? null : site.wind_dir ?? null,
        wind_kmh: own?.wind_kmh != null ? own.wind_kmh : site.wind_kmh ?? null,
        source: site.source,
        observed_impact: own?.observed_impact ?? null,
      });
      continue;
    }
    const siteWind = site.wind_kmh != null;
    out.push({
      entry_date: date,
      temp_min: site.temp_min ?? own?.temp_min ?? null,
      temp_max: site.temp_max ?? own?.temp_max ?? null,
      rainfall_mm: site.rainfall_mm ?? own?.rainfall_mm ?? null,
      wind_dir: siteWind ? site.wind_dir ?? null : own?.wind_dir ?? null,
      wind_kmh: siteWind ? site.wind_kmh : own?.wind_kmh ?? null,
      source: site.source,
      observed_impact: own?.observed_impact ?? null,
    });
  }
  return out;
}

function pickNum(a: unknown, b: unknown, combine: (x: number, y: number) => number): number | null {
  const x = a == null ? null : num(a);
  const y = b == null ? null : num(b);
  if (x == null) return y;
  if (y == null) return x;
  return combine(x, y);
}

export function aggregateWeather(
  rows: Array<Record<string, unknown>>,
  station: string | null = null,
): WeeklyData['weather'] {
  const out = rows
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
    .map((row) => ({
      date: String(row.entry_date ?? ''),
      temp_min: row.temp_min == null ? null : num(row.temp_min),
      temp_max: row.temp_max == null ? null : num(row.temp_max),
      rainfall_mm: row.rainfall_mm == null ? null : num(row.rainfall_mm),
      wind_dir: (row.wind_dir as string | null) ?? null,
      wind_kmh: row.wind_kmh == null ? null : num(row.wind_kmh),
      impact: (row.observed_impact as string | null) ?? null,
    }));
  return {
    rows: out,
    totalRainfallMm: round2(out.reduce((sum, r) => sum + (r.rainfall_mm ?? 0), 0)),
    station,
  };
}

export function aggregateVariations(
  rows: Array<Record<string, unknown>>,
): WeeklyData['variations'] {
  const out = rows
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
    .map((row) => {
      const vr = ((row.vr_ref as string | null) ?? '').trim() || null;
      return {
        date: String(row.entry_date ?? ''),
        entry_no: String(row.entry_no ?? ''),
        description: String(row.description ?? ''),
        directed_by: (row.directed_by as string | null) ?? null,
        vr_ref: vr,
        estimated_cost: row.estimated_cost == null ? null : num(row.estimated_cost),
        referenced: vr != null,
      };
    });
  return { rows: out, unreferenced: out.filter((v) => !v.referenced).length };
}

/** Work performed, chronological — what the labour hours were spent on. */
export function aggregateWorkItems(
  rows: Array<Record<string, unknown>>,
): WeeklyData['workItems'] {
  const out = rows
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
    .map((row) => ({
      date: String(row.entry_date ?? ''),
      entry_no: String(row.entry_no ?? ''),
      area: (row.area as string | null) ?? null,
      description: String(row.description ?? ''),
      percent_complete: row.percent_complete == null ? null : num(row.percent_complete),
    }));
  return { rows: out };
}

/**
 * Dayworks — the billable time-and-materials items. The one section whose
 * whole purpose is to be rolled up and claimed, so its absence from a weekly
 * report is money leaking, not tidiness.
 */
export function aggregateDayworks(
  rows: Array<Record<string, unknown>>,
): WeeklyData['dayworks'] {
  const out = rows
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
    .map((row) => {
      const ref = ((row.docket_ref as string | null) ?? '').trim() || null;
      return {
        date: String(row.entry_date ?? ''),
        entry_no: String(row.entry_no ?? ''),
        description: String(row.description ?? ''),
        labour: (row.labour as string | null) ?? null,
        plant: (row.plant as string | null) ?? null,
        materials: (row.materials as string | null) ?? null,
        hours: row.hours == null ? null : num(row.hours),
        docket_ref: ref,
      };
    });
  return {
    rows: out,
    totalHours: round2(out.reduce((sum, r) => sum + (r.hours ?? 0), 0)),
    unreferenced: out.filter((r) => !r.docket_ref).length,
  };
}

async function diaryQuery(
  supabase: SupabaseClient,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc(
    'run_diary_query',
    { p_sql: sql, p_limit: 1000 },
    { get: true },
  );
  if (error) throw new WeeklyLoadError(`Could not read the diary: ${error.message}`);
  return ((data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []);
}

/**
 * Load and aggregate one project's week. RLS decides what the caller may see;
 * an empty `entries` array means there is nothing signed in the range.
 */
/**
 * Unsigned days in a weekly report.
 *
 * The signed record is the record — the claims register, the register and
 * Ask still see nothing else, and a daily PDF still only exists for a signed
 * day. But a *report* that omits five of seven days of real work tells the
 * person reading it something false about the job. So the week can include
 * days still being worked on, with every one of them marked, a band across
 * the top saying how many, and the figures described as able to change. A
 * reader is never left to assume a number is settled when it is not.
 */
export interface WeeklyOptions {
  includeUnsigned?: boolean;
}

export async function loadWeeklyData(
  supabase: SupabaseClient,
  project: { id: string; name: string; code: string; orgCode: string },
  start: string,
  end: string,
  options: WeeklyOptions = {},
): Promise<WeeklyData> {
  if (!UUID_RE.test(project.id)) throw new WeeklyLoadError('Bad project id.');
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) throw new WeeklyLoadError('Bad date range.');
  const days = datesInRange(start, end);
  if (days.length === 0) throw new WeeklyLoadError('The end date is before the start date.');
  if (days.length > MAX_RANGE_DAYS) {
    throw new WeeklyLoadError(`A report covers at most ${MAX_RANGE_DAYS} days.`);
  }

  // Fixed statements, one per view. The project id and dates are validated
  // against strict shapes above before interpolation, and the RPC underneath
  // is read-only and RLS-scoped regardless.
  const scope = (view: string, cols: string) =>
    `select ${cols} from diary.${view} where project_id = '${project.id}' ` +
    `and entry_date >= '${start}' and entry_date <= '${end}' order by entry_date`;

  const [entries, labour, plant, pours, quantities, delays, weather, variations, workItems, dayworks] =
    await Promise.all([
      diaryQuery(supabase, scope('entries', 'entry_no, entry_date, author_name, signed_at, notes')),
      diaryQuery(supabase, scope('labour', 'entry_date, person_name, role, hours, overtime_hours')),
      diaryQuery(supabase, scope('plant', 'entry_date, item, hire_type, hours, idle_hours, supplier')),
      diaryQuery(
        supabase,
        scope('pours', 'entry_no, entry_date, location, volume_m3, mix_spec, supplier'),
      ),
      diaryQuery(supabase, scope('quantities', 'entry_no, entry_date, item_type, area, quantity, unit')),
      diaryQuery(
        supabase,
        scope(
          'delays',
          'entry_no, entry_date, cause, category, start_time, end_time, duration_mins, personnel_affected',
        ),
      ),
      diaryQuery(
        supabase,
        scope(
          'weather',
          'entry_date, temp_min, temp_max, rainfall_mm, wind_dir, wind_kmh, source, observed_impact',
        ),
      ),
      diaryQuery(
        supabase,
        scope(
          'variations',
          'entry_no, entry_date, description, directed_by, vr_ref, estimated_cost',
        ),
      ),
      diaryQuery(
        supabase,
        scope('work_items', 'entry_no, entry_date, area, description, percent_complete'),
      ),
      diaryQuery(
        supabase,
        scope('dayworks', 'entry_no, entry_date, description, labour, plant, materials, hours, docket_ref'),
      ),
    ]);

  const entryRows: WeeklyEntryRow[] = entries.map((row) => ({
    entry_no: String(row.entry_no ?? ''),
    entry_date: String(row.entry_date ?? ''),
    author_name: (row.author_name as string | null) ?? null,
    signed_at: (row.signed_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    signed: true,
  }));

  // Days still being worked on. Read through the ordinary tables rather than
  // the diary views — those are the signed record and stay that way — so RLS
  // is what decides visibility here, exactly as on the entry screen.
  const unsignedDays: string[] = [];
  if (options.includeUnsigned) {
    const { data: drafts, error: draftError } = await supabase
      .from('entries')
      .select(
        `id, entry_date, notes, supersedes_entry_id, author:profiles!entries_author_profiles_fkey(full_name, email),
         labour(person_name, role, hours, overtime_hours),
         plant(item, hire_type, hours, idle_hours, supplier),
         work_items(area, description, percent_complete),
         variations(description, directed_by, vr_ref, estimated_cost),
         delays(cause, category, start_time, end_time, duration_mins, personnel_affected),
         pours(location, volume_m3, mix_spec, supplier),
         quantities(item_type, area, quantity, unit),
         dayworks(description, labour, plant, materials, hours, docket_ref),
         weather(temp_min, temp_max, rainfall_mm, wind_dir, wind_kmh, source, observed_impact)`,
      )
      .eq('project_id', project.id)
      .eq('status', 'draft')
      .gte('entry_date', start)
      .lte('entry_date', end)
      .order('entry_date');
    if (draftError) throw new WeeklyLoadError(`Could not read the week's drafts: ${draftError.message}`);

    // A draft that corrects a signed day is that day's working version. It
    // replaces the signed day in the report rather than sitting beside it —
    // beside it, every person on the day was counted twice and a Tuesday
    // came out at eighty-five hours. Which serial it corrects is looked up
    // so the report can say so.
    const correctedDates = new Set<string>();
    const correctionOf = new Map<string, string>();
    const priorIds = (drafts ?? [])
      .map((d) => d.supersedes_entry_id as string | null)
      .filter((v): v is string => Boolean(v));
    if (priorIds.length > 0) {
      const { data: priors } = await supabase.from('entries').select('id, entry_no').in('id', priorIds);
      for (const pr of priors ?? []) if (pr.entry_no) correctionOf.set(pr.id as string, pr.entry_no as string);
      for (const d of drafts ?? []) if (d.supersedes_entry_id) correctedDates.add(String(d.entry_date));
    }
    const dropCorrected = <T extends Record<string, unknown>>(rows: T[]) =>
      rows.filter((r) => !correctedDates.has(String(r.entry_date)));
    if (correctedDates.size > 0) {
      for (let i = entryRows.length - 1; i >= 0; i -= 1) {
        if (correctedDates.has(entryRows[i].entry_date)) entryRows.splice(i, 1);
      }
      for (const list of [labour, plant, workItems, variations, delays, pours, quantities, dayworks, weather]) {
        const kept = dropCorrected(list);
        list.length = 0;
        list.push(...kept);
      }
    }

    for (const draft of drafts ?? []) {
      const date = String(draft.entry_date);
      unsignedDays.push(date);
      const author = Array.isArray(draft.author) ? draft.author[0] : draft.author;
      const prior = draft.supersedes_entry_id ? correctionOf.get(draft.supersedes_entry_id as string) : null;
      entryRows.push({
        entry_no: prior ? `DRAFT correcting ${prior}` : 'DRAFT',
        entry_date: date,
        author_name:
          (author as { full_name?: string | null; email?: string | null } | null)?.full_name ??
          (author as { email?: string | null } | null)?.email ??
          null,
        signed_at: null,
        notes: (draft.notes as string | null) ?? null,
        signed: false,
      });

      // Every child row carries the day it belongs to, the way the diary
      // views hand them over, so the aggregations need no special case.
      // PostgREST hands back a list for a one-to-many embed and a bare object
      // for a one-to-one — weather is the one-to-one, and assuming a list
      // there took the whole report down.
      const stamp = (rows: unknown, extra: Record<string, unknown> = {}) => {
        const list = rows == null ? [] : Array.isArray(rows) ? rows : [rows];
        return (list as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          entry_date: date,
          entry_no: 'DRAFT',
          ...extra,
        }));
      };
      labour.push(...stamp(draft.labour));
      plant.push(...stamp(draft.plant));
      workItems.push(...stamp(draft.work_items));
      variations.push(...stamp(draft.variations));
      delays.push(...stamp(draft.delays));
      pours.push(...stamp(draft.pours));
      quantities.push(...stamp(draft.quantities));
      dayworks.push(...stamp(draft.dayworks));
      weather.push(...stamp(draft.weather));
    }
    entryRows.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  }

  // The site's own weather, one row per day whether or not a diary was
  // written (see weather/days.ts). Read under the caller's RLS; a project
  // without site coordinates simply has none, and the diary readings stand.
  const { data: siteDays } = await supabase
    .from('project_weather_days')
    .select('day, temp_min, temp_max, rainfall_mm, wind_dir, wind_kmh, source, station_name')
    .eq('project_id', project.id)
    .gte('day', start)
    .lte('day', end);
  const dayRows = (siteDays ?? []) as Array<Record<string, unknown>>;
  const weatherRows = mergeWeatherDays(weather, dayRows, days);
  const station = dayRows.length > 0 ? ((dayRows[0].station_name as string | null) ?? null) : null;

  const labourAgg = aggregateLabour(labour, days);
  const poursAgg = aggregatePours(pours);
  const delaysAgg = aggregateDelays(delays);
  const variationsAgg = aggregateVariations(variations);
  const covered = new Set(entryRows.map((e) => e.entry_date));

  return {
    project,
    start,
    end,
    days,
    entries: entryRows,
    unsigned: { days: [...new Set(unsignedDays)], entryCount: unsignedDays.length },
    labour: labourAgg,
    plant: aggregatePlant(plant),
    pours: poursAgg,
    workItems: aggregateWorkItems(workItems),
    dayworks: aggregateDayworks(dayworks),
    quantities: aggregateQuantities(quantities),
    delays: delaysAgg,
    weather: aggregateWeather(weatherRows, station),
    variations: variationsAgg,
    counts: {
      daysInRange: days.length,
      daysWithEntries: covered.size,
      daysWithoutEntries: days.length - covered.size,
      entryCount: entryRows.length,
      peopleCount: labourAgg.people.length,
      pourCount: poursAgg.rows.length,
      dayworkCount: dayworks.length,
      delayCount: delaysAgg.rows.length,
      variationCount: variationsAgg.rows.length,
    },
  };
}
