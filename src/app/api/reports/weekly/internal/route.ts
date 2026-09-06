import { fail, requireApiUser, isUuid, isDate } from '@/lib/api';
import { loadWeeklyData, WeeklyLoadError } from '@/lib/weekly/load';
import { renderWeeklyPdf } from '@/lib/weekly/render';
import { ensureProjectWeatherDays } from '@/lib/weather/days';
import { BrowserUnavailableError } from '@/lib/pdf/render';

// Chromium only — no model call — so well inside a minute.
export const maxDuration = 90;
export const runtime = 'nodejs';

/**
 * The weekly as the office reads it: the same tables as the screen, nothing
 * else. No AI commentary, no DRAFT marks, not stored — this is a working
 * document for wages and progress, not the report that goes to a client.
 * The client report (with commentary, with every unsigned figure marked) is
 * still POST /api/reports/weekly.
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

  try {
    await ensureProjectWeatherDays(supabase, project.id, start, end).catch(() => null);
    const data = await loadWeeklyData(
      supabase,
      { id: project.id, name: project.name, code: project.code, orgCode },
      start,
      end,
      { includeUnsigned: true },
    );
    if (data.entries.length === 0) {
      return fail('not_found', 'No diary entries in that range yet.', 404);
    }
    const pdf = await renderWeeklyPdf({ data, narrative: null, audience: 'internal' });
    const filename = `${orgCode}_${project.code}_weekly_${start}_${end}.pdf`;
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof WeeklyLoadError) return fail('bad_request', error.message, 400);
    if (error instanceof BrowserUnavailableError) {
      return fail('server_error', 'The PDF renderer is not available on this host.', 503);
    }
    return fail('server_error', error instanceof Error ? error.message : 'Could not render the PDF.', 500);
  }
}
