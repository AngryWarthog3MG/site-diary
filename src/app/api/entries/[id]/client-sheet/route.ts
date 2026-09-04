import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos, collectSignatures } from '@/lib/pdf/photos';
import { renderClientSheetPdf, BrowserUnavailableError } from '@/lib/pdf/render';
import { clientSheetPath } from '@/lib/pdf/paths';

export const maxDuration = 300;
export const runtime = 'nodejs';

const LINK_TTL_SECONDS = 3600;

/**
 * The dayworks and variations sheet for a signed entry — what goes to the
 * client. Byte-identical on every render, so a stored copy is reused.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const entry = await loadDocketEntry(supabase, id);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status !== 'signed') {
    return fail('bad_request', 'Only a signed entry can go to the client. Sign it first.', 409);
  }
  const items = (entry.dayworks?.length ?? 0) + (entry.variations?.length ?? 0);
  if (items === 0) {
    return fail('bad_request', 'No dayworks or variations on this day — nothing to send.', 409);
  }

  const admin = createAdminClient();
  const objectPath = clientSheetPath(entry);
  const existing = await admin.storage.from('exports').createSignedUrl(objectPath, LINK_TTL_SECONDS);
  if (existing.data?.signedUrl) {
    return ok({ url: existing.data.signedUrl, path: objectPath, items, regenerated: false });
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderClientSheetPdf({
      entry,
      photos: await collectPhotos(supabase, entry),
      signatures: await collectSignatures(supabase, entry),
    });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'PDF rendering failed.';
    return fail('server_error', `Could not render the sheet: ${message}`, 500);
  }

  const { error: uploadError } = await admin.storage
    .from('exports')
    .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) {
    return fail('server_error', `Could not store the sheet: ${uploadError.message}`, 500);
  }
  const { data: link, error: linkError } = await admin.storage
    .from('exports')
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);

  return ok({ url: link.signedUrl, path: objectPath, items, regenerated: true, bytes: pdf.length });
}
