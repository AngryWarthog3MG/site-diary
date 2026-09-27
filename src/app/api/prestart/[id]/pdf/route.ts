import { fail, ok, requireApiUser, isUuid, forbidUnlessSees } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { BrowserUnavailableError } from '@/lib/pdf/render';
import { prestartPdf, PrestartDocError } from '@/lib/prestart/document';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The finished prestart as one branded PDF. Reuses the stored copy — a finished prestart is immutable, so its
 * document is too. The building is `prestartPdf`, shared with the week's bundle (README R109).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad prestart id.', 400);

  const { data: row } = await supabase.from('prestarts').select('project_id').eq('id', id).maybeSingle();
  if (!row) return fail('not_found', 'That prestart is not on any of your projects.', 404);
  const forbidden = await forbidUnlessSees(supabase, user.id, row.project_id as string, 'prestart');
  if (forbidden) return forbidden;

  let doc;
  try {
    doc = await prestartPdf(supabase, id);
  } catch (error) {
    if (error instanceof PrestartDocError) return fail(error.status === 409 ? 'bad_request' : error.status === 404 ? 'not_found' : 'server_error', error.message, error.status);
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    return fail('server_error', `Could not render the prestart: ${error instanceof Error ? error.message : 'PDF rendering failed.'}`, 500);
  }
  const { data: link, error: linkError } = await createAdminClient().storage.from('exports').createSignedUrl(doc.path, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return doc.reused
    ? ok({ url: link.signedUrl, path: doc.path, reused: true })
    : ok({ url: link.signedUrl, path: doc.path, attendees: doc.attendees, bytes: doc.bytes.length });
}
