import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
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
 * is reused rather than regenerated. Pass `?force=1` after a template change.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const entry = await loadDocketEntry(supabase, id);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);

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
  const force = new URL(request.url).searchParams.get('force') === '1';

  if (!force) {
    const existing = await admin.storage
      .from(EXPORTS_BUCKET)
      .createSignedUrl(objectPath, LINK_TTL_SECONDS);
    if (existing.data?.signedUrl) {
      return ok({ url: existing.data.signedUrl, path: objectPath, regenerated: false });
    }
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
      upsert: true,
    });

  if (uploadError) {
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
