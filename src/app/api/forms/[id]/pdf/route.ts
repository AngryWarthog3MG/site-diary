import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid, forbidUnlessSees } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { perthDate } from '@/lib/pdf/dates';
import { FormDoc, FORM_CSS, type FormPdfData } from '@/lib/forms/pdf';
import { loadSubmission, loadNonCompliances, namesFor } from '@/lib/forms/load';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** A completed form with its non-compliances and photographs, stored per state (README R180). Never over an existing file. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad form id.', 400);
  const s = await loadSubmission(supabase, id);
  if (!s) return fail('not_found', 'That form is not on any of your projects.', 404);
  const forbidden = await forbidUnlessSees(supabase, user.id, s.project_id, 'forms');
  if (forbidden) return forbidden;
  if (s.status === 'open') return fail('bad_request', 'Complete the form first — the PDF is the frozen record.', 409);
  const { data: proj } = await supabase.from('projects').select('name, code, org:organisations!inner(name, code)').eq('id', s.project_id).single();
  if (!proj) return fail('not_found', 'Project not found.', 404);
  const org = Array.isArray(proj.org) ? proj.org[0] : proj.org;
  const [ncs, nameOf, machine] = await Promise.all([
    loadNonCompliances(supabase, { submissionId: s.id }, { includeClosed: true }),
    namesFor(supabase, [s.completed_by, s.started_by]),
    s.subject_plant_id ? supabase.from('plant_register').select('name, plant_no').eq('id', s.subject_plant_id).maybeSingle().then((r) => r.data as { name: string; plant_no: string | null } | null) : Promise.resolve(null),
  ]);
  const sortedNcs = [...ncs].sort((a, b) => a.question_key.localeCompare(b.question_key));
  const stateHash = createHash('sha256').update(JSON.stringify({ c: s.completed_at, v: s.voided_at, n: sortedNcs.map((n) => [n.question_key, n.status, n.resolved_at, n.removed_at, n.action, n.owner_name, n.due_on]) })).digest('hex');
  const objectPath = `${s.project_id}/form/${s.id}-${stateHash.slice(0, 8)}.pdf`;
  const admin = createAdminClient();
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }
  const dataUri = async (path: string) => {
    const { data } = await admin.storage.from('entry-photos').download(path);
    if (!data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return `data:${data.type || 'image/jpeg'};base64,${bytes.toString('base64')}`;
  };
  const photos: FormPdfData['photos'] = {};
  for (const q of s.spec.sections.flatMap((x) => x.questions)) {
    const list: Array<{ src: string }> = [];
    for (const p of s.answers[q.key]?.photo_paths ?? []) { const src = await dataUri(p); if (src) list.push({ src }); }
    if (list.length) photos[q.key] = list;
  }
  const signature = s.signature_path ? await dataUri(s.signature_path) : null;
  const latest = [s.completed_at, s.voided_at, ...sortedNcs.map((n) => n.resolved_at), ...sortedNcs.map((n) => n.removed_at)].filter((v): v is string => Boolean(v)).sort().at(-1);
  const instant = new Date(latest ?? (s.completed_at as string));
  const day = perthDate(s.completed_at);
  const data: FormPdfData = {
    orgName: org.name, orgCode: org.code, projectName: proj.name, projectCode: proj.code,
    code: s.template_code, revision: s.revision, title: s.template_title, basis: null,
    subjectLine: machine ? `${machine.name}${machine.plant_no ? ` · ${machine.plant_no}` : ''}` : s.subject_person,
    header: s.spec.header.map((h) => ({ label: h.label, value: s.header[h.key] == null ? '—' : String(s.header[h.key]) })),
    spec: s.spec, answers: s.answers, photos,
    status: s.status, outcome: s.outcome, score: s.score, passMark: s.pass_mark,
    completedBy: nameOf.get(s.completed_by ?? s.started_by) ?? 'Unnamed', completedAwst: finishedAtAwst(s.completed_at as string, s.completed_on_device_at),
    voided: s.voided_at ? `${finishedAtAwst(s.voided_at, null)} — ${s.void_reason ?? ''}` : null,
    ncs: sortedNcs.map((n) => ({ label: n.question_label, answer: n.answer, status: n.status, action: n.raised_as_action ? n.action : null, owner: n.owner_name, due: n.due_on, resolution: n.resolution, removed_reason: n.removed_reason, resolved_at: n.resolved_at })),
    signature, printedAwst: finishedAtAwst(instant.toISOString(), null),
  };
  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>${s.template_code} ${day}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>${FORM_CSS}</style>`, '</head><body>',
      renderToStaticMarkup(FormDoc({ data })), '</body></html>'].join('');
    pdf = await renderPdfDocument(html, {
      title: `${s.template_title} ${day} — ${proj.name}`, author: org.name,
      subject: `${proj.name} — ${s.template_code}, ${day}`, keywords: [org.code, proj.code, s.template_code, day, 'form'],
      instant, idSeed: stateHash, footerLeft: `${org.code}_${proj.code} · ${s.template_code} rev ${s.revision} · ${day}`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the form: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) return fail('server_error', `Could not store the PDF: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, bytes: pdf.length });
}
