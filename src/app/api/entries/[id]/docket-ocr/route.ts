import { fail, ok, requireApiUser, isUuid, readJson } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { readDocketImage, DocketOcrError, type DocketImageMediaType } from '@/lib/docket/ocr';

export const maxDuration = 60;
export const runtime = 'nodejs';

const PHOTO_BUCKET = 'entry-photos';
const MAX_BYTES = 8 * 1024 * 1024;

const MEDIA_TYPES: Record<string, DocketImageMediaType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Read a photographed delivery docket (brief §4).
 *
 * The photo is already in storage — the review screen uploads it to the
 * entry's own path first, exactly like any other photo — so this route takes
 * the path, not the bytes. The entry must be a caller-visible draft: docket
 * reconciliation edits the draft, and signed entries do not get edited.
 * Reconciliation itself happens on the review screen, where the supervisor
 * can see what the docket overruled.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const body = await readJson(request);
  const photoPath = typeof body?.photo_path === 'string' ? body.photo_path : null;
  if (!photoPath) return fail('bad_request', 'photo_path is required.', 400);

  // RLS answers both "does this entry exist" and "may you see it".
  const { data: entry } = await supabase
    .from('entries')
    .select('id, project_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('bad_request', 'This entry is signed. A docket cannot change it now.', 409);
  }

  // Only this entry's own photos — the path is client-supplied.
  if (!photoPath.startsWith(`${entry.project_id}/${entry.id}/`) || photoPath.includes('..')) {
    return fail('bad_request', 'That photo does not belong to this entry.', 400);
  }

  const extension = photoPath.split('.').pop()?.toLowerCase() ?? '';
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) {
    return fail(
      'bad_request',
      'That image format cannot be read. Use the camera (JPEG) or a PNG.',
      400,
    );
  }

  const admin = createAdminClient();
  const { data: file, error: downloadError } = await admin.storage
    .from(PHOTO_BUCKET)
    .download(photoPath);
  if (downloadError || !file) {
    return fail('not_found', 'The docket photo was not found in storage.', 404);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return fail('bad_request', 'That photo is too large to read. Retake it.', 400);
  }

  try {
    const read = await readDocketImage({ data: buffer.toString('base64'), mediaType });
    return ok({ read });
  } catch (error) {
    if (error instanceof DocketOcrError) {
      return fail('server_error', error.message, error.retryable ? 503 : 500);
    }
    return fail('server_error', 'Docket reading failed.', 500);
  }
}
