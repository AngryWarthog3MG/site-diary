import { createHash } from 'node:crypto';
import { fail, requireApiUser, isUuid, forbidUnlessSees } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { perthToday } from '@/lib/push/decide';
import { readRange } from '@/lib/dayworks/schedule';
import { loadDayworksSchedule } from '@/lib/dayworks/load';
import { scheduleLines } from '@/lib/dayworks/schedule';
import { loadDayworkPhotos } from '@/lib/dayworks/photos';
import { dayworksScheduleHtml, dayworksSignoffHtml, type SheetApproval } from '@/lib/dayworks/pdf';
import { approvalOf, type DayworkSignoff } from '@/lib/dayworks/signoff';
import { fmtDate } from '@/lib/pdf/dates';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The dayworks schedule for a period as a PDF. Returned directly; nothing stored.
 *
 * `?signoff=1` returns the client sign-off sheet instead: the same dayworks
 * itemised, with the photographs taken on each and a block for the head
 * contractor to sign (README R83).
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { data: project } = await supabase.from('projects').select('id, name, code, principal_contractor, org:organisations!inner(name, code)').eq('id', projectId).maybeSingle();
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
  const signoff = url.searchParams.get('signoff') === '1';
  const common = { orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code, periodLabel: range.label, today };
  let html: string;
  // Kept out of the HTML and handed to the page one at a time — README R84.
  let images: Record<string, string> | undefined;
  if (signoff) {
    // The photographs run under the caller's RLS, like everything else here.
    const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    const photos = await loadDayworkPhotos(supabase, scheduleLines(data));
    // What the client has already signed for is printed as signed, with the signature drawn on the screen (README R125).
    const { data: signoffRows } = await supabase.from('dayworks_signoffs')
      .select('id, period_from, period_to, period_label, items, hours, hours_not_recorded, photos, signed_by_name, signed_by_position, signed_on, file_path, note, signed_how, signature_path, signed_at, lines')
      .eq('project_id', projectId);
    const signoffs = ((signoffRows ?? []) as unknown as DayworkSignoff[]).map((s) => ({ ...s, hours: Number(s.hours) }));
    const approval = approvalOf(scheduleLines(data), signoffs);
    const itemsOf = new Map<string, number[]>();
    approval.by.forEach((s, i) => { if (s) itemsOf.set(s.id, [...(itemsOf.get(s.id) ?? []), i + 1]); });
    const approvals: SheetApproval[] = [];
    for (const s of signoffs.filter((x) => itemsOf.has(x.id)).sort((a, b) => (itemsOf.get(a.id)![0] ?? 0) - (itemsOf.get(b.id)![0] ?? 0))) {
      let src: string | null = null;
      if (s.signature_path) {
        const { data: blob } = await supabase.storage.from('dayworks-signoffs').download(s.signature_path);
        if (blob) src = `data:image/png;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      }
      const at = s.signed_at ? new Date(Date.parse(s.signed_at) + 8 * 3_600_000).toISOString() : null;
      approvals.push({
        items: itemsOf.get(s.id)!, name: s.signed_by_name, position: s.signed_by_position, signedOn: s.signed_on,
        signedAt: at ? `${fmtDate(at.slice(0, 10))} ${at.slice(11, 16)} AWST` : null,
        how: s.signed_how === 'on_screen' ? 'on_screen' : 'paper', src,
      });
    }
    const built = dayworksSignoffHtml(data, photos, {
      ...common,
      clientName: (project.principal_contractor as string | null) ?? null,
      preparedBy: (me?.full_name as string | null) ?? '',
      approvals,
    });
    html = built.html;
    images = built.images;
  } else {
    html = dayworksScheduleHtml(data, common);
  }
  const kind = signoff ? 'sign-off sheet' : 'schedule';
  const slug = range.from || range.to ? `${range.from ?? 'start'}_${range.to ?? today}` : 'whole-job';
  try {
    const pdf = await renderPdfDocument(html, {
      title: `Dayworks ${kind} — ${project.name} — ${range.label}`, author: org.name, subject: `${project.name} — dayworks ${kind}`, keywords: [org.code, project.code, 'dayworks'],
      instant: new Date(`${today}T00:00:00Z`),
      // The photographs are no longer in the html, so they join the seed by name and size.
      idSeed: createHash('sha256').update(html).update(Object.entries(images ?? {}).map(([k, v]) => `${k}:${v.length}`).join('|')).digest('hex'),
      images,
      // 900px is legible evidence of what was done and keeps the sheet small
      // enough to email from site (owner, 2026-09-18).
      imageMax: 900,
      footerLeft: `${org.code}_${project.code} · DAYWORKS ${signoff ? 'SIGN-OFF' : 'SCHEDULE'} · ${range.label.toUpperCase()}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_${project.code}_dayworks${signoff ? '_signoff' : ''}_${slug}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the ${kind}: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
