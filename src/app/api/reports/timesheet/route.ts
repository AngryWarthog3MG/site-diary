import { fail, requireApiUser, isUuid, isDate } from '@/lib/api';
import { loadWeeklyData, WeeklyLoadError } from '@/lib/weekly/load';
import { buildTimesheetCsv, timesheetFilename } from '@/lib/weekly/timesheet';

export const runtime = 'nodejs';

/**
 * The timesheet CSV (labour hours by person and day, signed entries only).
 *
 * A plain GET that downloads the file — no storage, no model call, no
 * Chromium. Reads run under the caller's RLS through the same fixed diary
 * queries as the weekly report, so this can only ever export what they can
 * already see.
 */
export async function GET(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!isDate(start) || !isDate(end)) {
    return fail('bad_request', 'start and end must be YYYY-MM-DD dates.', 400);
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  let data;
  try {
    data = await loadWeeklyData(
      supabase,
      { id: project.id, name: project.name, code: project.code, orgCode },
      start,
      end,
    );
  } catch (error) {
    if (error instanceof WeeklyLoadError) return fail('bad_request', error.message, 400);
    throw error;
  }

  if (data.entries.length === 0) {
    return fail('not_found', 'No signed entries in that range — nothing to put on a timesheet.', 404);
  }

  return new Response(buildTimesheetCsv(data), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${timesheetFilename(data)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
