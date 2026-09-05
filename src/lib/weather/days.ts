import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchDailyClimate } from './daily';
import {
  dailyForDay,
  monthsCovering,
  nextDay,
  stateFolder,
  stationSlug,
  type DailyClimateRow,
} from './daily-parse';
import { deriveWeather, hasObservations, mergeWeather } from './derive';
import { resolveStation, type ProjectSite } from './resolve';
import type { DerivedWeather } from './types';
import type { ProjectWeatherDay } from '@/types/database';

/**
 * The site's weather, one row per day, kept whether or not anyone wrote a
 * diary that day (`public.project_weather_days`).
 *
 * Two sources, in order of authority:
 *   1. The Bureau's daily climate table — final figures for max, min and the
 *      24 hours of rain from 09:00. Published the morning after (two mornings
 *      after, for rain), so it settles each day once and for all.
 *   2. Live observations from the same gauge, merged the way an entry's are,
 *      for the day still under way and the day the table has not reached yet.
 *
 * Nothing here is part of the signed record, and nothing here overwrites a
 * reading a supervisor typed into a diary — the Today screen prefers that
 * reading when it shows the week.
 */

export type { ProjectWeatherDay };

export type RefreshOutcome =
  | { ok: true; days: number; station: string; dailyMonths: number }
  | { ok: false; reason: string };

/** Every ISO date from `from` to `to`, inclusive. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) out.push(d);
  return out;
}

function asDerived(row: ProjectWeatherDay): DerivedWeather {
  return {
    temp_max: row.temp_max,
    temp_min: row.temp_min,
    rainfall_mm: row.rainfall_mm,
    wind_dir: row.wind_dir,
    wind_kmh: row.wind_kmh,
    station_id: row.station_id,
    station_name: row.station_name,
    station_distance_km: null,
    observed_from: null,
    observed_to: null,
  };
}

/**
 * Bring a project's day rows up to date for [from, to]. Idempotent; safe to
 * call from a screen and from the daily cron alike.
 */
export async function refreshProjectWeatherDays(
  project: ProjectSite,
  from: string,
  to: string,
  now = new Date(),
): Promise<RefreshOutcome> {
  const station = await resolveStation(project);
  if (!station.ok) return station;
  const { choice, productId } = station;
  const admin = createAdminClient();

  const { data: existingRows } = await admin
    .from('project_weather_days')
    .select('*')
    .eq('project_id', project.id)
    .gte('day', from)
    .lte('day', to);
  const existing = new Map<string, ProjectWeatherDay>();
  for (const row of (existingRows ?? []) as ProjectWeatherDay[]) existing.set(row.day, row);

  // The daily table, if this station has one. A failure here is not fatal:
  // observations still describe today.
  let daily: DailyClimateRow[] = [];
  let dailyMonths = 0;
  const state = stateFolder(productId);
  if (state) {
    try {
      const byMonth = await fetchDailyClimate(state, stationSlug(choice.station.name), monthsCovering(from, to));
      dailyMonths = byMonth.size;
      for (const rows of byMonth.values()) daily = daily.concat(rows);
    } catch {
      dailyMonths = 0;
    }
  }

  const stationId = choice.station.wmoId ?? choice.station.bomId;
  const upserts: Omit<ProjectWeatherDay, 'fetched_at'>[] = [];
  for (const day of eachDay(from, to)) {
    const prior = existing.get(day);
    // Rows from a different gauge are replaced, never blended (see mergeWeather).
    let merged: DerivedWeather | null =
      prior && (prior.station_id == null || prior.station_id === stationId) ? asDerived(prior) : null;

    const obs = deriveWeather(choice, day, now);
    if (hasObservations(obs)) merged = mergeWeather(merged, obs);

    const table = dailyForDay(daily, day);
    let source: ProjectWeatherDay['source'] = prior?.source === 'bom_daily' ? 'bom_daily' : 'bom_obs';
    if (table) {
      // The table is the settled figure for the same gauge: it overrides a
      // running observation. A blank in the table leaves what we have.
      merged = merged ?? asDerived({ ...blank(project.id, day), station_id: stationId, station_name: choice.station.name });
      if (table.temp_max != null) merged.temp_max = table.temp_max;
      if (table.temp_min != null) merged.temp_min = table.temp_min;
      if (table.rainfall_mm != null) merged.rainfall_mm = table.rainfall_mm;
      // Average wind only fills a gap; an observed speed and direction are better.
      if (merged.wind_kmh == null && table.wind_kmh != null) merged.wind_kmh = table.wind_kmh;
      if (table.temp_max != null || table.temp_min != null || table.rainfall_mm != null) source = 'bom_daily';
    }

    if (!merged) continue;
    if ([merged.temp_max, merged.temp_min, merged.rainfall_mm, merged.wind_kmh].every((v) => v == null)) continue;

    upserts.push({
      project_id: project.id,
      day,
      temp_max: merged.temp_max,
      temp_min: merged.temp_min,
      rainfall_mm: merged.rainfall_mm,
      wind_dir: merged.wind_dir,
      wind_kmh: merged.wind_kmh,
      source,
      station_id: stationId,
      station_name: choice.station.name,
    });
  }

  if (upserts.length > 0) {
    const fetched_at = now.toISOString();
    const { error } = await admin
      .from('project_weather_days')
      .upsert(upserts.map((u) => ({ ...u, fetched_at })), { onConflict: 'project_id,day' });
    if (error) return { ok: false, reason: error.message };
  }

  return { ok: true, days: upserts.length, station: choice.station.name, dailyMonths };
}

function blank(project_id: string, day: string): ProjectWeatherDay {
  return {
    project_id,
    day,
    temp_max: null,
    temp_min: null,
    rainfall_mm: null,
    wind_dir: null,
    wind_kmh: null,
    source: 'bom_obs',
    station_id: null,
    station_name: null,
    fetched_at: '',
  };
}

/** The stored rows for [from, to], under the caller's own RLS. */
export async function loadProjectWeatherDays(
  supabase: SupabaseClient,
  projectId: string,
  from: string,
  to: string,
): Promise<ProjectWeatherDay[]> {
  const { data } = await supabase
    .from('project_weather_days')
    .select('*')
    .eq('project_id', projectId)
    .gte('day', from)
    .lte('day', to)
    .order('day');
  return ((data ?? []) as ProjectWeatherDay[]);
}

/**
 * Whether the stored week is fresh enough to show without a fetch. The daily
 * table changes once a day and observations every ten minutes; a half hour
 * is plenty for a glance and keeps the FTP traffic to a handful a day.
 */
export const DAYS_TTL_MS = 30 * 60 * 1000;

export function daysAreFresh(rows: readonly ProjectWeatherDay[], now = new Date()): boolean {
  const latest = Math.max(...rows.map((r) => Date.parse(r.fetched_at)), 0);
  return now.getTime() - latest < DAYS_TTL_MS;
}
