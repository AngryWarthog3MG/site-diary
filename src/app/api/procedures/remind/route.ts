import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyAssignees, pendingAssignees } from '@/lib/documents-control/notify';

export const runtime = 'nodejs';

/**
 * Remind the people still to sign a version — all of them, or the ones named (README R120). The database decides
 * who may: the stamp RPC refuses anyone who does not keep the company's documents, and it is called before a word
 * is sent.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const versionId = body?.versionId;
  const userIds: string[] | undefined = Array.isArray(body?.userIds) ? body.userIds.filter((u: unknown) => isUuid(u)) : undefined;
  if (!isUuid(versionId)) return fail('bad_request', 'Bad version id.', 400);
  const { data: v, error } = await supabase.from('document_versions').select('id, version, status, document:controlled_documents!inner(id, title)').eq('id', versionId).maybeSingle();
  if (error || !v) return fail('not_found', 'That version is not on your account.', 404);
  const doc = (Array.isArray(v.document) ? v.document[0] : v.document) as { id: string; title: string };
  const admin = createAdminClient();
  const assignees = await pendingAssignees(admin, versionId, userIds);
  if (assignees.length === 0) return ok({ people: 0, pushed: 0, emailed: 0, message: 'Nobody is still to sign.' });
  // The gate: stamping the first reminder as the caller. A non-manager is refused here and nothing is sent.
  const { error: refused } = await supabase.rpc('record_document_reminder', { p_assignment: assignees[0].assignmentId });
  if (refused) return fail('forbidden', 'Only someone who issues documents sends reminders.', 403);
  // The first stamp is already on; the helper stamps the rest.
  const out = await notifyAssignees(admin, { versionId, documentId: doc.id, title: doc.title, version: v.version as number, reason: 'reminder', assignees, alreadyStamped: new Set([assignees[0].assignmentId]) });
  return ok({ ...out, message: `Reminded ${out.people} ${out.people === 1 ? 'person' : 'people'}: ${out.pushed} phone notifications, ${out.emailed} emails.` });
}
