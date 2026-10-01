import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyAssignees, pendingAssignees } from '@/lib/documents-control/notify';

export const runtime = 'nodejs';

/**
 * A version has just been issued: tell everyone assigned (README R120). The caller must be able to manage the
 * company's documents — the database's own check, through the stamp RPC, decides that before a word is sent.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const versionId = body?.versionId;
  if (!isUuid(versionId)) return fail('bad_request', 'Bad version id.', 400);
  const { data: v, error } = await supabase.from('document_versions').select('id, version, status, document:controlled_documents!inner(id, title)').eq('id', versionId).maybeSingle();
  if (error || !v) return fail('not_found', 'That version is not on your account.', 404);
  if (v.status !== 'current') return fail('bad_request', 'Only the current version is announced.', 400);
  // The manager check: the stamp RPC refuses anyone who does not keep the company's documents.
  const { error: probe } = await supabase.rpc('record_document_notified', { p_version: versionId, p_detail: 'announcing' });
  if (probe) return fail('forbidden', 'Only someone who issues documents sends this.', 403);
  const doc = (Array.isArray(v.document) ? v.document[0] : v.document) as { id: string; title: string };
  const admin = createAdminClient();
  const assignees = await pendingAssignees(admin, versionId);
  const out = await notifyAssignees(admin, { versionId, documentId: doc.id, title: doc.title, version: v.version as number, reason: 'issued', assignees });
  return ok({ ...out, message: out.people === 0 ? 'Nobody is assigned this version.' : `Told ${out.people} ${out.people === 1 ? 'person' : 'people'}: ${out.pushed} phone notifications, ${out.emailed} emails.` });
}
