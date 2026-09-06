import { canSee } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { DOCUMENTS_BUCKET } from '@/lib/documents/index';

/** Remove a document and its file. Any project member; RLS decides visibility. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad document id.', 400);

  const { data: doc } = await supabase
    .from('project_documents')
    .select('id, storage_path, project_id')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return fail('not_found', 'That document is not on one of your projects.', 404);
  const { data: membership } = await supabase.from('project_members').select('role').eq('project_id', (doc as { project_id?: string }).project_id ?? '').eq('user_id', user.id).maybeSingle();
  if (!membership || !canSee(membership.role as MemberRole, 'documents')) return fail('forbidden', 'Your role on this job does not include documents.', 403);

  const { error } = await supabase.from('project_documents').delete().eq('id', id);
  if (error) return fail('server_error', error.message, 500);
  await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
  return ok({ deleted: id });
}
