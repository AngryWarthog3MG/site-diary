import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { PRESTART_CSS } from '@/lib/prestart/pdf';
import { PlantPrestartDoc, PLANT_CSS, type PlantPrestartPdfData } from '@/lib/plant/pdf';
import { readChecks, PLANT_KIND_LABEL, OWNERSHIP_LABEL, isPlantKind, type Ownership } from '@/lib/plant/checklist';
import { finishedAtAwst } from '@/lib/pdf/finished-at';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** The signed plant prestart as one branded PDF; the stored copy is reused. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad plant prestart id.', 400);

  const { data: row } = await supabase
    .from('plant_prestarts')
    .select(
      `id, project_id, prestart_date, operator_name, hour_meter, checks, fit_for_use, notes, signature_path, completed_at, completed_on_device_at,
       plant:plant_register!inner(name, kind, make_model, plant_no, ownership, supplier),
       project:projects!inner(name, code, org:organisations!inner(name, code))`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!row) return fail('not_found', 'That plant prestart is not on any of your projects.', 404);
  if (!row.completed_at) return fail('bad_request', 'Sign the prestart first — the PDF is the frozen record.', 409);

  const admin = createAdminClient();
  const objectPath = `${row.project_id}/plant/${row.prestart_date}-${row.id}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }

  const first = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  const plant = first(row.plant) as { name: string; kind: string; make_model: string | null; plant_no: string | null; ownership: string; supplier: string | null };
  const project = first(row.project) as { name: string; code: string; org: unknown };
  const org = first(project.org) as { name: string; code: string };

  const { data: defectRows } = await supabase
    .from('plant_defects')
    .select('item_label, note, photo_path')
    .eq('prestart_id', row.id)
    .order('raised_at');
  const toDataUrl = async (path: string | null, mime: string) => {
    if (!path) return null;
    const { data } = await admin.storage.from('entry-photos').download(path);
    if (!data) return null;
    return `data:${mime};base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`;
  };
  const defects: PlantPrestartPdfData['defects'] = [];
  for (const d of defectRows ?? []) {
    defects.push({ label: d.item_label as string, note: (d.note as string | null) ?? null, src: await toDataUrl(d.photo_path as string | null, 'image/jpeg') });
  }

  const completedAtAwst = finishedAtAwst(row.completed_at as string, row.completed_on_device_at as string | null);
  const meta = [
    isPlantKind(plant.kind) ? PLANT_KIND_LABEL[plant.kind] : null,
    plant.make_model,
    plant.plant_no ? `No. ${plant.plant_no}` : null,
    OWNERSHIP_LABEL[plant.ownership as Ownership] ?? null,
    plant.supplier,
  ].filter(Boolean).join(' · ');

  const data: PlantPrestartPdfData = {
    orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code,
    date: row.prestart_date as string,
    plantName: plant.name,
    plantMeta: meta,
    operator: row.operator_name as string,
    hourMeter: row.hour_meter == null ? null : Number(row.hour_meter),
    checks: readChecks(row.checks),
    defects,
    fitForUse: Boolean(row.fit_for_use),
    notes: (row.notes as string | null) ?? null,
    completedAtAwst,
    signatureSrc: await toDataUrl(row.signature_path as string | null, 'image/png'),
  };

  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = [
      '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">',
      `<title>Plant prestart ${row.prestart_date}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style><style>${DOCKET_CSS}</style><style>${PRESTART_CSS}</style><style>${PLANT_CSS}</style>`,
      '</head><body>', renderToStaticMarkup(PlantPrestartDoc({ data })), '</body></html>',
    ].join('');
    pdf = await renderPdfDocument(html, {
      title: `Plant prestart ${row.prestart_date} — ${plant.name}`,
      author: org.name,
      subject: `${project.name} — plant prestart, ${plant.name}, ${row.prestart_date}`,
      keywords: [org.code, project.code, row.prestart_date as string, 'plant prestart'],
      instant: new Date(row.completed_at),
      idSeed: row.id.replace(/-/g, ''),
      footerLeft: `${org.code}_${project.code} · PLANT PRESTART · ${row.prestart_date}`,
    });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    return fail('server_error', `Could not render the plant prestart: ${error instanceof Error ? error.message : 'PDF rendering failed.'}`, 500);
  }

  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) return fail('server_error', `Could not store the PDF: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, bytes: pdf.length });
}
