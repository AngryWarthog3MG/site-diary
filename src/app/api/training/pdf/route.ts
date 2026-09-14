import { createHash } from 'node:crypto';
import { fail, requireApiUser, isUuid } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { buildMatrix, competencies, mergePeople } from '@/lib/training/model';
import type { TicketFacts } from '@/lib/crew/tickets';

export const maxDuration = 300;
export const runtime = 'nodejs';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The job's training matrix as a PDF, as of today. Returned directly; nothing stored. */
export async function GET(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { data: project } = await supabase.from('projects').select('id, name, code, org:organisations!inner(id, name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { id: string; name: string; code: string };
  const today = perthToday();
  const [{ data: crew }, { data: tickets }, { data: reqs }, { data: custom }] = await Promise.all([
    supabase.from('crew').select('name, role').eq('project_id', projectId).eq('active', true),
    supabase.from('crew_tickets').select('person_name, ticket_type, expires_on, active, issued_on').eq('org_id', org.id),
    supabase.from('competency_requirements').select('role, competency').eq('org_id', org.id),
    supabase.from('org_competencies').select('key, label, valid_months, active').eq('org_id', org.id),
  ]);
  const crewList = ((crew ?? []) as Array<{ name: string; role: string | null }>);
  const norm = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  const people = mergePeople(crewList, ((tickets ?? []) as Array<TicketFacts & { person_name: string; issued_on: string | null }>).filter((t) => crewList.some((c) => norm(c.name) === norm(t.person_name))));
  const { rows, columns } = buildMatrix(people, competencies((custom ?? []) as Array<{ key: string; label: string; valid_months: number | null; active: boolean }>), (reqs ?? []) as Array<{ role: string; competency: string }>, today);
  const mark: Record<string, string> = { current: '●', expiring: '◔', expired: '✕', missing: '' };
  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Training matrix — ${esc(project.name)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    `<style>.tm th.col{writing-mode:vertical-rl;transform:rotate(180deg);font-size:7pt;padding:1mm;height:34mm;text-align:left} .tm td.c{text-align:center;font-size:9pt;width:6mm} .tm td.req{background:#FDECEC;color:#9A2B2B;font-weight:700} .tm td.exp{color:#9A6A09} .tm .gaps{color:#9A2B2B}</style>`,
    '</head><body><div class="docket tm">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p><h1>Training matrix</h1><p class="mono sub">${esc(project.name)} · ${esc(org.code)}_${esc(project.code)}</p></div><div class="head__right"><p class="lbl">As of</p><p class="mono">${esc(fmtDate(today))}</p></div></header>`,
    '<section class="sect"><table><thead><tr><th class="w">Person</th><th>Role</th>', ...columns.map((c) => `<th class="col">${esc(c.label)}</th>`), '</tr></thead><tbody>',
    ...rows.map((r) => `<tr><td class="w">${esc(r.name)}</td><td>${esc(r.role ?? '—')}</td>${columns.map((c) => { const cell = r.cells[c.key]; const bad = cell.required && (cell.state === 'missing' || cell.state === 'expired'); return `<td class="c${bad ? ' req' : cell.state === 'expiring' ? ' exp' : ''}">${bad && cell.state === 'missing' ? '✕' : mark[cell.state]}</td>`; }).join('')}</tr>`),
    '</tbody></table>',
    `<p class="src">● current · ◔ expiring within 30 days · ✕ expired or required and not held (red). ${rows.filter((r) => r.gaps.length).length} of ${rows.length} people have a gap against their role.</p>`,
    ...rows.filter((r) => r.gaps.length).map((r) => `<p class="gaps">${esc(r.name)}: ${esc(r.gaps.join(', '))}</p>`),
    '</section></div></body></html>'].join('');
  try {
    const pdf = await renderPdfDocument(html, {
      title: `Training matrix — ${project.name}`, author: org.name, subject: `${project.name} — training matrix ${today}`, keywords: [org.code, project.code, 'training'],
      instant: new Date(`${today}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'), footerLeft: `${org.code}_${project.code} · TRAINING · ${today}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_${project.code}_training_${today}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the matrix: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
