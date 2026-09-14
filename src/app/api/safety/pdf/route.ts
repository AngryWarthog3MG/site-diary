import { createHash } from 'node:crypto';
import { fail, requireApiUser, isUuid } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { loadSafety } from '@/lib/safety/load';
import { VERDICT_LABEL, type Verdict } from '@/lib/subcontractors/model';

export const maxDuration = 300;
export const runtime = 'nodejs';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The safety summary as of today, for a client's monthly report. Returned directly; nothing stored. */
export async function GET(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { data: project } = await supabase.from('projects').select('id, name, code, org:organisations!inner(id, name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { id: string; name: string; code: string };
  const today = perthToday();
  const d = await loadSafety(supabase, projectId, org.id, today);
  const y = d.incidents.year;
  const row = (k: string, v: string | number) => `<tr><th>${esc(k)}</th><td class="mono">${esc(v)}</td></tr>`;
  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Safety summary — ${esc(project.name)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>.sf tbody th{text-align:left;width:70mm;font-weight:600} .sf .bad{color:#9A2B2B;font-weight:700}</style>`,
    '</head><body><div class="docket sf">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p><h1>Safety summary</h1><p class="mono sub">${esc(project.name)} · ${esc(org.code)}_${esc(project.code)}</p></div><div class="head__right"><p class="lbl">As of</p><p class="mono">${esc(fmtDate(today))}</p></div></header>`,
    '<section class="sect"><p class="lbl">Last 12 months</p><table><tbody>',
    row('Hours worked (labour on signed diaries)', y.hoursWorked.toLocaleString('en-AU')),
    row('Injuries — medical treatment or worse', y.mti), row('Injuries — first aid', y.fai), row('Near misses reported', y.nearMiss), row('Hazards reported', y.hazards), row('Notifiable incidents', y.notifiable),
    row('Injury rate per million hours (medical or worse)', y.ratePerMillionHours == null ? '—' : y.ratePerMillionHours),
    row('Days since last injury', d.incidents.daysSinceInjury == null ? 'No injury recorded' : d.incidents.daysSinceInjury),
    '</tbody></table><p class="src">The rate divides medical-treatment-or-worse injuries by labour hours on signed diaries. Lost-time days are not recorded, so this is not an LTIFR.</p></section>',
    '<section class="sect"><p class="lbl">Reports by month</p><table><thead><tr><th>Month</th><th>Total</th><th>Injuries</th><th>Near misses</th><th>Hazards</th></tr></thead><tbody>',
    ...d.incidents.months.map((m) => `<tr><td>${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}</td><td class="mono">${m.total}</td><td class="mono">${m.injuries}</td><td class="mono">${m.nearMisses}</td><td class="mono">${m.hazards}</td></tr>`),
    '</tbody></table></section>',
    '<section class="sect"><p class="lbl">Open today</p><table><tbody>',
    row('Corrective actions open', d.actions.open), row('Corrective actions overdue', d.actions.overdue), row('Reports open', d.incidents.open), row('Inspections signed, last 90 days', d.inspections.last90),
    row('Permits live now', d.permits.live), row('Permits past their window, not closed', d.permits.expired), row('On site now', d.onSiteNow),
    '</tbody></table></section>',
    '<section class="sect"><p class="lbl">Outstanding</p>',
    d.tickets.expired.length ? `<p class="bad">Tickets expired: ${esc(d.tickets.expired.map((t) => `${t.person} (${t.label}, ${fmtDate(t.on)})`).join('; '))}</p>` : '',
    d.tickets.soon.length ? `<p>Tickets expiring within 30 days: ${esc(d.tickets.soon.map((t) => `${t.person} (${t.label}, ${fmtDate(t.on)})`).join('; '))}</p>` : '',
    d.subcontractors.length ? `<p class="bad">Subcontractors: ${esc(d.subcontractors.map((s) => `${s.name} — ${VERDICT_LABEL[s.verdict as Verdict]}`).join('; '))}</p>` : '',
    d.swms.length ? `<p>SWMS not signed by everyone: ${esc(d.swms.map((s) => `${s.title} v${s.version} (${s.unsigned.join(', ')})`).join('; '))}</p>` : '',
    d.documents.length ? `<p>Documents not read by everyone: ${esc(d.documents.map((x) => `${x.title} v${x.version} (${x.unread.join(', ')})`).join('; '))}</p>` : '',
    !d.tickets.expired.length && !d.tickets.soon.length && !d.subcontractors.length && !d.swms.length && !d.documents.length ? '<p class="nil">Nothing outstanding</p>' : '',
    '</section></div></body></html>'].join('');
  try {
    const pdf = await renderPdfDocument(html, {
      title: `Safety summary — ${project.name}`, author: org.name, subject: `${project.name} — safety summary ${today}`, keywords: [org.code, project.code, 'safety'],
      instant: new Date(`${today}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'), footerLeft: `${org.code}_${project.code} · SAFETY · ${today}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_${project.code}_safety_${today}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the summary: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
