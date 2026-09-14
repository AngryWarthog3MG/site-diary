import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { notifyOffice } from '@/lib/incidents/notify';

/**
 * Tell the office about this report. Any member of the project may ask;
 * the sending itself is claimed once by the service role (notify.ts), so a
 * retry or a second tab cannot email everyone twice.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad report id.', 400);
  const { data: r } = await supabase.from('incidents').select('id').eq('id', id).maybeSingle();
  if (!r) return fail('not_found', 'Not your report.', 404);
  const outcome = await notifyOffice(id);
  if (!outcome.sent && outcome.reason === 'send failed') return fail('server_error', 'The email could not be sent. Tell the office by phone; the app will retry tonight.', 502);
  return ok(outcome);
}
