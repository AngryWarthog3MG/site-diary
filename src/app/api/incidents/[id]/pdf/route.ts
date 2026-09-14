import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { IncidentDoc, INCIDENT_CSS, type IncidentPdfData } from '@/lib/incidents/pdf';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** The report with its actions, updates and photos, stored per state. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad report id.', 400);

  const { data: r } = await supabase
    .from('incidents')
    .select(`*, project:projects!inner(name, code, org:organisations!inner(name, code)),
      reporter:profiles!incidents_reported_by_profiles_fkey(full_name, email),
      incident_updates(kind, body, created_at, author:profiles!incident_updates_created_by_profiles_fkey(full_name, email)),
      incident_actions(action, owner_name, due_on, done_at, done_note, created_at)`)
    .eq('id', id)
    .maybeSingle();
  if (!r) return fail('not_found', 'That report is not on any of your projects.', 404);
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  const who = (p: unknown) => { const x = (Array.isArray(p) ? p[0] : p) as { full_name?: string | null; email?: string | null } | null; return x?.full_name ?? x?.email ?? '—'; };
  const admin = createAdminClient();

  const updates = ((r.incident_updates ?? []) as Array<{ kind: string; body: string; created_at: string; author: unknown }>)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const actions = ((r.incident_actions ?? []) as Array<{ action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null; created_at: string }>)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const stateHash = createHash('sha256').update(JSON.stringify({ s: r.status, c: r.closed_at, u: updates.map((u) => u.created_at), a: actions })).digest('hex');
  const objectPath = `${r.project_id}/incident/${r.id}-${stateHash.slice(0, 8)}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }

  const photos: IncidentPdfData['photos'] = [];
  for (const path of (r.photo_urls ?? []) as string[]) {
    const { data } = await admin.storage.from('entry-photos').download(path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    photos.push({ src: `data:${data.type || 'image/jpeg'};base64,${bytes.toString('base64')}` });
  }
  const latest = [r.reported_at as string, r.closed_at as string | null, ...updates.map((u) => u.created_at), ...actions.map((a) => a.done_at)].filter((v): v is string => Boolean(v)).sort().at(-1);
  const instant = new Date(latest ?? (r.reported_at as string));
  const data: IncidentPdfData = {
    orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code,
    seq: r.seq, kind: r.kind, status: r.status, notifiable: r.notifiable, occurred_at: r.occurred_at, reported_on_device_at: r.reported_on_device_at,
    reported_by: who(r.reporter), location: r.location, description: r.description, immediate_actions: r.immediate_actions,
    people_involved: r.people_involved ?? [], witnesses: r.witnesses ?? [], injured_name: r.injured_name, injury_type: r.injury_type, body_part: r.body_part,
    treatment: r.treatment, actual_severity: r.actual_severity, potential_severity: r.potential_severity, plant: r.plant, photos,
    updates: updates.map((u) => ({ kind: u.kind, body: u.body, at: u.created_at, by: who(u.author) })),
    actions: actions.map((a) => ({ action: a.action, owner: a.owner_name, due: a.due_on, done_at: a.done_at, done_note: a.done_note })),
    closed_at: r.closed_at, printedAwst: finishedAtAwst(instant.toISOString(), null),
  };

  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Report ${r.seq}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>${INCIDENT_CSS}</style>`, '</head><body>',
      renderToStaticMarkup(IncidentDoc({ data })), '</body></html>'].join('');
    pdf = await renderPdfDocument(html, {
      title: `${data.kind} report ${r.seq} — ${project.name}`, author: org.name,
      subject: `${project.name} — ${data.kind} report`, keywords: [org.code, project.code, data.kind, `INC-${r.seq}`],
      instant, idSeed: stateHash, footerLeft: `${org.code}_${project.code} · INCIDENT · INC-${String(r.seq).padStart(3, '0')}`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the report: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) return fail('server_error', `Could not store the PDF: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, bytes: pdf.length });
}
