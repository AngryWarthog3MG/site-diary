import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { PrestartDoc, PRESTART_CSS, type PrestartPdfData } from './pdf';
import { readSpecNotes } from './spec-notes';
import { readChecklist } from './checklist';
import { finishedAtAwst } from '@/lib/pdf/finished-at';

export class PrestartDocError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * A finished prestart's PDF (README R109): the stored copy when there is one — a finished prestart is frozen, so its
 * document is too — else rendered once and stored. One path for the single prestart's button and the week's bundle,
 * so the two can never print a prestart differently. The caller has already checked the person may open prestarts.
 */
export async function prestartPdf(supabase: SupabaseClient, id: string): Promise<{ bytes: Uint8Array; path: string; reused: boolean; attendees: number }> {
  const { data: row } = await supabase
    .from('prestarts')
    .select(PRESTART_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!row) throw new PrestartDocError('That prestart is not on any of your projects.', 404);
  if (!row.completed_at) throw new PrestartDocError('Finish the prestart first — the PDF is the frozen record.', 409);

  const admin = createAdminClient();
  const objectPath = `${row.project_id}/prestart/${row.prestart_date}-${row.id}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  const sorted = (row.prestart_attendees as AttendeeRow[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (existing.data) {
    return { bytes: new Uint8Array(await existing.data.arrayBuffer()), path: objectPath, reused: true, attendees: sorted.length };
  }

  const pdf = await renderPrestart(row as unknown as PrestartRow, sorted, { clientCopy: false });
  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) throw new PrestartDocError(`Could not store the prestart PDF: ${uploadError.message}`, 500);
  return { bytes: pdf, path: objectPath, reused: false, attendees: sorted.length };
}

/**
 * A finished prestart printed for someone outside the company (README R124): the same record, the same signatures,
 * without the app's own induction check beside each sign-on — that check compares the name as signed with the job's
 * induction list, and a nickname at sign-on reads as "not inducted". Rendered each time, marked CLIENT COPY in its
 * footer, and NEVER stored: the stored PDF stays the record, with the check on it.
 */
export async function prestartClientPdf(supabase: SupabaseClient, id: string): Promise<{ bytes: Uint8Array; attendees: number }> {
  const { data: row } = await supabase.from('prestarts').select(PRESTART_SELECT).eq('id', id).maybeSingle();
  if (!row) throw new PrestartDocError('That prestart is not on any of your projects.', 404);
  if (!row.completed_at) throw new PrestartDocError('Finish the prestart first — the PDF is the frozen record.', 409);
  const sorted = (row.prestart_attendees as AttendeeRow[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { bytes: await renderPrestart(row as unknown as PrestartRow, sorted, { clientCopy: true }), attendees: sorted.length };
}

const PRESTART_SELECT = `id, project_id, prestart_date, supervisor_name, work_planned, hazards, plant, permits, notes, spec_notes,
       checklist, completed_at, completed_on_device_at,
       project:projects!inner(name, code, org:organisations!inner(name, code)),
       prestart_attendees(attendee_name, fit_for_work, signature_path, inducted, created_at)`;
type AttendeeRow = { attendee_name: string; fit_for_work: boolean; signature_path: string; inducted: boolean | null; created_at: string };
type Named = { name: string; code: string };
interface PrestartRow {
  id: string; prestart_date: string; supervisor_name: string; work_planned: string; hazards: string; plant: string | null; permits: string | null; notes: string | null;
  spec_notes: unknown; checklist: unknown; completed_at: string; completed_on_device_at: string | null;
  project: (Named & { org: Named | Named[] }) | Array<Named & { org: Named | Named[] }>;
}

async function renderPrestart(row: PrestartRow, sorted: AttendeeRow[], { clientCopy }: { clientCopy: boolean }): Promise<Uint8Array> {
  const admin = createAdminClient();
  const project = Array.isArray(row.project) ? row.project[0] : row.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  // Induction is read from the sign-on itself — a fact about that morning — never from today's induction list.
  const attendees: PrestartPdfData['attendees'] = [];
  for (const a of sorted) {
    const { data } = await admin.storage.from('entry-photos').download(a.signature_path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    attendees.push({ name: a.attendee_name, fit: a.fit_for_work, src: `data:image/png;base64,${bytes.toString('base64')}`, inducted: clientCopy || a.inducted == null ? undefined : a.inducted });
  }
  const data: PrestartPdfData = {
    orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code,
    date: row.prestart_date, supervisor: row.supervisor_name, workPlanned: row.work_planned, hazards: row.hazards,
    plant: row.plant ?? null, permits: row.permits ?? null, notes: row.notes ?? null,
    checklist: readChecklist(row.checklist), specNotes: readSpecNotes(row.spec_notes),
    completedAtAwst: finishedAtAwst(row.completed_at, row.completed_on_device_at),
    attendees,
  };
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = [
    '<!doctype html>',
    '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>Prestart ${row.prestart_date}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`,
    `<style>${DOCKET_CSS}</style>`,
    `<style>${PRESTART_CSS}</style>`,
    '</head><body>',
    renderToStaticMarkup(PrestartDoc({ data })),
    '</body></html>',
  ].join('');
  const pdf: Uint8Array = await renderPdfDocument(html, {
    title: `Prestart ${row.prestart_date} — ${project.name}`,
    author: org.name,
    subject: `${project.name} — daily prestart, ${row.prestart_date}`,
    keywords: [org.code, project.code, row.prestart_date, 'prestart'],
    instant: new Date(row.completed_at),
    idSeed: clientCopy ? `${row.id.replace(/-/g, '').slice(0, 24)}c11e47c0` : row.id.replace(/-/g, ''),
    footerLeft: `${org.code}_${project.code} · PRESTART · ${row.prestart_date}${clientCopy ? ' · CLIENT COPY' : ''}`,
  });
  return pdf;
}
