import { canSee } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { indexDocument } from '@/lib/documents/index';

// Reading a long scanned document is several model calls.
export const maxDuration = 300;
export const runtime = 'nodejs';

/** Read (or re-read) a document into search chunks. Any project member. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad document id.', 400);

  // Under the caller's RLS: a document they cannot see does not exist.
  const { data: doc } = await supabase.from('project_documents').select('id, project_id').eq('id', id).maybeSingle();
  if (!doc) return fail('not_found', 'That document is not on one of your projects.', 404);
  const { data: membership } = await supabase.from('project_members').select('role').eq('project_id', (doc as { project_id?: string }).project_id ?? '').eq('user_id', user.id).maybeSingle();
  if (!membership || !canSee(membership.role as MemberRole, 'documents')) return fail('forbidden', 'Your role on this job does not include documents.', 403);

  const outcome = await indexDocument(id);
  if (!outcome.ok) return fail('bad_request', outcome.reason, 422);
  return ok(outcome);
}
