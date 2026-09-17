import { fail, ok, requireApiUser, isUuid, forbidUnlessSees } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos } from '@/lib/pdf/photos';
import { collectSignatures } from '@/lib/pdf/photos';
import { renderDailyPdf, BrowserUnavailableError } from '@/lib/pdf/render';

// Launching Chromium and laying out a document is not a fast request.
export const maxDuration = 300;
export const runtime = 'nodejs';

const EXPORTS_BUCKET = 'exports';
const LINK_TTL_SECONDS = 60 * 60;

/**
 * Generate the daily PDF, store it, and hand back a shareable link (§6).
 *
 * Reading happens under the caller's own RLS, so a PM can export an entry and
 * a stranger cannot. Writing to the exports bucket uses the service role: the
 * bucket deliberately has no client insert policy, because a generated record
 * should only ever come from the generator.
 *
 * A signed entry's PDF is byte-identical on every render, so an existing file
 * is reused and NEVER regenerated over: the stored PDF is the record (README
 * R78 — this route used to overwrite it on `?force=1`, and whenever making a
 * link to it failed for a moment).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const entry = await loadDocketEntry(supabase, id);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  const forbidden = await forbidUnlessSees(supabase, user.id, entry.project_id as string, 'entries');
  if (forbidden) return forbidden;

  if (entry.status !== 'signed') {
    return fail(
      'bad_request',
      'Only a signed entry has a daily PDF. Sign it first.',
      409,
    );
  }

  const admin = createAdminClient();
  // The exports bucket policy reads the first path segment as a project id, so
  // members can find their own project's exports. A human-readable code here
  // would make every stored PDF invisible to them.
  const objectPath = `${entry.project_id}/${entry.entry_no}.pdf`;

  const existing = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);
  if (existing.data?.signedUrl) {
    return ok({ url: existing.data.signedUrl, path: objectPath, regenerated: false });
  }
  // No link is not proof there is no file: a Storage blip looks the same. Establish absence
  // before rendering anything, and never render over a file that is there.
  const { data: listed, error: listError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .list(entry.project_id as string, { search: `${entry.entry_no}.pdf`, limit: 100 });
  if (listError) {
    return fail('server_error', `Could not confirm whether this day's PDF is already stored: ${listError.message}. Try again in a moment.`, 503);
  }
  if ((listed ?? []).some((o) => o.name === `${entry.entry_no}.pdf`)) {
    return fail('server_error', 'This day\'s PDF is stored but a link could not be made just now. Try again in a moment — it will not be regenerated.', 503);
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderDailyPdf({
      entry,
      photos: await collectPhotos(supabase, entry),
      signatures: await collectSignatures(supabase, entry),
    });
  } catch (error) {
    // A host without a browser is a deployment gap, not a broken record — say
    // which it is rather than handing back a stack trace.
    if (error instanceof BrowserUnavailableError) {
      return fail('server_error', error.message, 501);
    }
    const message = error instanceof Error ? error.message : 'PDF rendering failed.';
    return fail('server_error', `Could not render the daily PDF: ${message}`, 500);
  }

  const { error: uploadError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(objectPath, Buffer.from(pdf), {
      contentType: 'application/pdf',
      upsert: false,
    });

  // Another request stored it first: that file is the record. Link it; this render is discarded.
  if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
    return fail('server_error', `Could not store the daily PDF: ${uploadError.message}`, 500);
  }

  const { data: link, error: linkError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);

  if (linkError || !link) {
    return fail('server_error', 'The PDF was stored but no link could be made.', 500);
  }

  return ok({ url: link.signedUrl, path: objectPath, regenerated: true, bytes: pdf.length });
}
