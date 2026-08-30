import { fail, ok, requireApiUser, isUuid, isDate } from '@/lib/api';
import { loadProjectSite, resolveWeather } from '@/lib/weather/resolve';
import { BOM_ATTRIBUTION } from '@/lib/weather/bom';

export const maxDuration = 30;

/**
 * Current conditions for a project, for display on the Today screen.
 *
 * Read-only: nothing is stored. Weather only becomes part of the record when
 * it is attached to an entry, which is POST /api/entries/[id]/weather.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);

  // The device's local date — the server's day is not the site's day.
  const date = new URL(request.url).searchParams.get('date');
  if (!isDate(date)) return fail('bad_request', 'date (YYYY-MM-DD) is required.', 400);

  const project = await loadProjectSite(supabase, projectId);
  if (!project) return fail('not_found', 'That project is not one of yours.', 404);

  const result = await resolveWeather(project, date);
  if (!result.ok) {
    return ok({ weather: null, reason: result.reason, attribution: BOM_ATTRIBUTION });
  }

  return ok({
    weather: result.weather,
    stale: result.stale,
    attribution: BOM_ATTRIBUTION,
  });
}
