import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { loadProjectSite } from '@/lib/weather/resolve';
import { daysAreFresh, loadProjectWeatherDays, refreshProjectWeatherDays } from '@/lib/weather/days';
import { BOM_ATTRIBUTION } from '@/lib/weather/bom';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The site's weather for a run of days — the Today screen's week table.
 *
 * Reads the day store and refreshes it from the Bureau first when it is more
 * than half an hour old (or `?refresh=1`). A member of the project sees it;
 * nobody writes to it from here — the server does, from the Bureau alone.
 */
export async function GET(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return fail('bad_request', 'from and to must be ISO dates, from first.', 400);
  }
  if (Date.parse(to) - Date.parse(from) > 31 * 86_400_000) {
    return fail('bad_request', 'At most a month at a time.', 400);
  }

  // RLS: a project the caller is not on comes back as nothing.
  const project = await loadProjectSite(supabase, projectId);
  if (!project) return fail('not_found', 'That project is not one of yours.', 404);

  let rows = await loadProjectWeatherDays(supabase, projectId, from, to);
  let reason: string | null = null;
  if (searchParams.get('refresh') === '1' || !daysAreFresh(rows)) {
    const outcome = await refreshProjectWeatherDays(project, from, to);
    if (outcome.ok) rows = await loadProjectWeatherDays(supabase, projectId, from, to);
    else reason = outcome.reason;
  }

  return ok({
    days: rows.map((r) => ({
      day: r.day,
      temp_max: r.temp_max,
      temp_min: r.temp_min,
      rainfall_mm: r.rainfall_mm,
      wind_dir: r.wind_dir,
      wind_kmh: r.wind_kmh,
      source: r.source,
    })),
    station: rows[0]?.station_name ?? null,
    reason,
    attribution: BOM_ATTRIBUTION,
  });
}
