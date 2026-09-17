import { createHash } from 'node:crypto';
import { fail, requireApiUser, isUuid, forbidUnlessSees } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { perthToday } from '@/lib/push/decide';
import { readRange } from '@/lib/dayworks/schedule';
import { loadDayworksSchedule } from '@/lib/dayworks/load';
import { dayworksScheduleHtml } from '@/lib/dayworks/pdf';

export const maxDuration = 120;
export const runtime = 'nodejs';

/** The dayworks schedule for a period as a PDF. Returned directly; nothing stored. */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { data: project } = await supabase.from('projects').select('id, name, code, org:organisations!inner(name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const forbidden = await forbidUnlessSees(supabase, user.id, projectId, 'claims');
  if (forbidden) return forbidden;
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { name: string; code: string };

  const today = perthToday();
  const range = readRange({ range: url.searchParams.get('range') ?? undefined, from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined }, today);
  let data;
  try {
    data = await loadDayworksSchedule(supabase, projectId, range);
  } catch (err) {
    return fail('server_error', err instanceof Error ? err.message : 'Could not load the schedule.', 500);
  }
  const html = dayworksScheduleHtml(data, { orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code, periodLabel: range.label, today });
  const slug = range.from || range.to ? `${range.from ?? 'start'}_${range.to ?? today}` : 'whole-job';
  try {
    const pdf = await renderPdfDocument(html, {
      title: `Dayworks schedule — ${project.name} — ${range.label}`, author: org.name, subject: `${project.name} — dayworks schedule`, keywords: [org.code, project.code, 'dayworks'],
      instant: new Date(`${today}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'), footerLeft: `${org.code}_${project.code} · DAYWORKS SCHEDULE · ${range.label.toUpperCase()}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_${project.code}_dayworks_${slug}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the schedule: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
