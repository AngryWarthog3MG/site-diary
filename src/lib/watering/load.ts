import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, isMethod, type WateringArea, type WateringClose, type WateringDay, type WateringEntry } from './model';

/**
 * One week of a job's watering register under the caller's RLS (README R190): the job's areas (retired ones too — a
 * week they have a line in still shows them), the week's lines and recorded days with the name of who recorded each,
 * whether the week is closed, and the Bureau's maximum for each day as a PROMPT beside the temperature box — never
 * written into the register by the app.
 */
export interface WateringWeek {
  areas: WateringArea[];
  entries: WateringEntry[];
  days: WateringDay[];
  closed: WateringClose | null;
  /** The Bureau's daily maximum for the job, by day, where it has one. */
  bureau: Record<string, number>;
}

export async function loadWateringWeek(supabase: SupabaseClient, projectId: string, monday: string): Promise<WateringWeek> {
  const sunday = addDays(monday, 6);
  const [areas, entries, days, closed, bureau] = await Promise.all([
    supabase.from('watering_areas').select('id, project_id, name, sort_order, active').eq('project_id', projectId).order('sort_order').order('name'),
    supabase.from('watering_entries').select('area_id, day, method, hours, supp_method, supp_hours, notes, updated_at, updated_by').eq('project_id', projectId).gte('day', monday).lte('day', sunday),
    supabase.from('watering_days').select('day, temp_max, recorded_at, recorded_by').eq('project_id', projectId).gte('day', monday).lte('day', sunday),
    supabase.from('watering_weeks').select('week_start, closed_at, closed_by').eq('project_id', projectId).eq('week_start', monday).maybeSingle(),
    supabase.from('project_weather_days').select('day, temp_max').eq('project_id', projectId).gte('day', monday).lte('day', sunday),
  ]);
  for (const r of [areas, entries, days, closed]) if (r.error) throw new Error(`Could not read the watering register: ${r.error.message}`);
  type RawEntry = { area_id: string; day: string; method: string | null; hours: number | string | null; supp_method: string | null; supp_hours: number | string | null; notes: string | null; updated_at: string | null; updated_by: string | null };
  type RawDay = { day: string; temp_max: number | string | null; recorded_at: string | null; recorded_by: string | null };
  const rawEntries = (entries.data ?? []) as RawEntry[];
  const rawDays = (days.data ?? []) as RawDay[];
  const closeRow = closed.data as { week_start: string; closed_at: string; closed_by: string | null } | null;
  const ids = [...new Set([...rawEntries.map((e) => e.updated_by), ...rawDays.map((d) => d.recorded_by), closeRow?.closed_by ?? null].filter((x): x is string => !!x))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name);
  }
  const num = (v: number | string | null) => (v == null ? null : Number(v));
  const temps: Record<string, number> = {};
  // The Bureau's table is a prompt; a week it cannot be read for simply has none.
  for (const b of ((bureau.error ? [] : bureau.data) ?? []) as Array<{ day: string; temp_max: number | string | null }>) if (b.temp_max != null) temps[b.day] = Number(b.temp_max);
  return {
    areas: (areas.data ?? []) as WateringArea[],
    entries: rawEntries.map((e) => ({
      area_id: e.area_id, day: e.day, method: isMethod(e.method) ? e.method : null, hours: num(e.hours), supp_method: isMethod(e.supp_method) ? e.supp_method : null, supp_hours: num(e.supp_hours),
      notes: e.notes, updated_at: e.updated_at, updated_by_name: e.updated_by ? (names.get(e.updated_by) ?? null) : null,
    })),
    days: rawDays.map((d) => ({ day: d.day, temp_max: num(d.temp_max), recorded_at: d.recorded_at, recorded_by_name: d.recorded_by ? (names.get(d.recorded_by) ?? null) : null })),
    closed: closeRow ? { week_start: closeRow.week_start, closed_at: closeRow.closed_at, closed_by_name: closeRow.closed_by ? (names.get(closeRow.closed_by) ?? null) : null } : null,
    bureau: temps,
  };
}
