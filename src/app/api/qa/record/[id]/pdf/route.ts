import { createHash } from 'node:crypto';
import { fail, requireApiUser, isUuid, forbidUnlessSees } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { perthToday } from '@/lib/push/decide';
import { loadQaRecord } from '@/lib/qa/load';
import { qaRecordHtml } from '@/lib/qa/pdf';

export const maxDuration = 300;
export const runtime = 'nodejs';

const PHOTO_MAX = 1200;

/**
 * One inspection and test record as a PDF (README R166), under the caller's RLS: the record, its signatures and its
 * photographs read as the caller may read them, rendered on demand, returned, never stored.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad record id.', 400);
  const { data: head } = await supabase.from('qa_records').select('project_id').eq('id', id).maybeSingle();
  if (!head) return fail('not_found', 'That record is not on your account.', 404);
  const projectId = head.project_id as string;
  const forbidden = await forbidUnlessSees(supabase, user.id, projectId, 'qa');
  if (forbidden) return forbidden;
  const loaded = await loadQaRecord(supabase, projectId, id, null);
  if (!loaded?.record) return fail('not_found', 'That record is not on your account.', 404);
  const { data: project } = await supabase.from('projects').select('name, code, org:organisations!inner(name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { name: string; code: string };

  // Signatures and photographs as data URIs, read under the caller's RLS; one that will not download is left out, not invented.
  const paths = [...loaded.record.signoffs.map((s) => s.signature_path), ...loaded.record.photo_paths].filter(Boolean);
  const images: Record<string, string> = {};
  for (const p of [...new Set(paths)]) {
    const { data: blob } = await supabase.storage.from('entry-photos').download(p);
    if (!blob) continue;
    const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : (p.endsWith('.png') ? 'image/png' : 'image/jpeg');
    images[p] = `data:${type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
  }
  const today = perthToday();
  const built = qaRecordHtml(loaded.template, loaded.record, { orgName: org.name, orgCode: org.code, projectName: project.name as string, projectCode: project.code as string, today, images });
  const lot = (loaded.record.lot_or_element ?? 'record').replace(/[^A-Za-z0-9._-]+/g, '_');
  try {
    const pdf = await renderPdfDocument(built.html, {
      title: `${loaded.template.code} — ${loaded.record.lot_or_element ?? loaded.record.id} — ${project.name}`, author: org.name, subject: `${loaded.template.title} · ${project.name}`, keywords: [org.code, project.code as string, loaded.template.code],
      instant: new Date(`${today}T00:00:00Z`),
      idSeed: createHash('sha256').update(built.html).update(Object.entries(built.images).map(([k, v]) => `${k}:${v.length}`).join('|')).digest('hex'),
      images: built.images,
      imageMax: PHOTO_MAX,
      footerLeft: `${org.code}_${project.code} · ${loaded.template.code} REV ${loaded.template.revision} · ${(loaded.record.lot_or_element ?? '').toUpperCase()}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_${project.code}_${loaded.template.code}_${lot}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the record: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
