import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { loadProjectSite, resolveWeather } from '@/lib/weather/resolve';
import { BOM_ATTRIBUTION } from '@/lib/weather/bom';
import { mergeWeather } from '@/lib/weather/derive';
import type { DerivedWeather } from '@/lib/weather/types';

export const maxDuration = 30;

/**
 * Attach the day's observations to a draft entry.
 *
 * Safe to call as often as you like, and worth doing: observations are merged
 * rather than replaced, so a supervisor who opens the app at smoko and again
 * at knock-off keeps this morning's minimum even though BOM's element has long
 * since moved on to tonight. Running maxima and rain totals only ever rise.
 *
 * A row the supervisor entered by hand (source = 'manual') is never touched.
 * They were on site; the gauge was not.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) return fail('bad_request', 'Bad entry id.', 400);

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .select('id, project_id, entry_date, status, author_id')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) return fail('server_error', entryError.message, 500);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('entry_signed', 'That entry is signed; its weather is part of the record.', 409);
  }
  if (entry.author_id !== user.id) {
    return fail('forbidden', 'That entry belongs to another supervisor.', 403);
  }

  const { data: existing } = await supabase
    .from('weather')
    .select('*')
    .eq('entry_id', entry.id)
    .maybeSingle();

  // A hand-entered *reading* is never overwritten. A row that carries only the
  // supervisor's observed_impact and no numbers is not a reading — it is a
  // note waiting for numbers, so BOM is still allowed to fill them in.
  const hasManualReading =
    existing?.source === 'manual' &&
    [existing.temp_max, existing.temp_min, existing.rainfall_mm, existing.wind_kmh].some(
      (value) => value != null,
    );

  if (hasManualReading) {
    return ok({ weather: existing, source: 'manual', attribution: BOM_ATTRIBUTION });
  }

  const project = await loadProjectSite(supabase, entry.project_id);
  if (!project) return fail('not_found', 'Project not found.', 404);

  const result = await resolveWeather(project, entry.entry_date);
  if (!result.ok) {
    return ok({ weather: existing ?? null, reason: result.reason, attribution: BOM_ATTRIBUTION });
  }

  const merged = mergeWeather(
    existing ? (existing as unknown as DerivedWeather) : null,
    result.weather,
  );

  // The site's day row (the Bureau's daily table, finalised the morning
  // after) fills anything the live observation could not — the overnight
  // minimum a late-afternoon fetch has already lost, say. Same gauge only,
  // and only into gaps: what the observation saw stands.
  const { data: dayRow } = await supabase
    .from('project_weather_days')
    .select('temp_max, temp_min, rainfall_mm, wind_kmh, station_id')
    .eq('project_id', entry.project_id)
    .eq('day', entry.entry_date)
    .maybeSingle();
  if (dayRow && (merged.station_id == null || dayRow.station_id == null || dayRow.station_id === merged.station_id)) {
    merged.temp_max ??= dayRow.temp_max;
    merged.temp_min ??= dayRow.temp_min;
    merged.rainfall_mm ??= dayRow.rainfall_mm;
    merged.wind_kmh ??= dayRow.wind_kmh;
  }

  const { data: saved, error: saveError } = await supabase
    .from('weather')
    .upsert(
      {
        entry_id: entry.id,
        ...merged,
        // Keep 'manual' if the supervisor is the one who opened this row.
        source: existing?.source === 'manual' ? 'manual' : 'bom_auto',
        fetched_at: new Date().toISOString(),
        // observed_impact is the supervisor's, not the Bureau's. Never overwritten.
        observed_impact: existing?.observed_impact ?? null,
      },
      { onConflict: 'entry_id' },
    )
    .select('*')
    .single();

  if (saveError) return fail('server_error', saveError.message, 500);

  return ok({ weather: saved, stale: result.stale, attribution: BOM_ATTRIBUTION });
}
