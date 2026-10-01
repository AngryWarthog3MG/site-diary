import { fail, forbidUnlessSees, isUuid, requireApiUser } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { canAuthorEntries } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { perthToday } from '@/lib/push/decide';
import { dueState, type AssignmentStatus } from '@/lib/documents-control/model';

export const runtime = 'nodejs';

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The assignments on every current version as a spreadsheet (README R120). Managers of the job named. */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const refused = await forbidUnlessSees(supabase, user.id, projectId, 'procedures');
  if (refused) return refused;
  const { data: member } = await supabase.from('project_members').select('role, project:projects!inner(org_id, code)').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!member || !canAuthorEntries(member.role as MemberRole)) return fail('forbidden', 'The overview is for supervisors, the PM and admins.', 403);
  const project = (Array.isArray(member.project) ? member.project[0] : member.project) as { org_id: string; code: string };
  const { data, error } = await supabase
    .from('document_assignments')
    .select('user_id, status, due_on, assigned_at, signed_at, reminder_count, waive_reason, version:document_versions!inner(version, status, document:controlled_documents!inner(title, doc_number, org_id, active))')
    .eq('version.document.org_id', project.org_id)
    .eq('version.document.active', true)
    .eq('version.status', 'current');
  if (error) return fail('server_error', error.message, 500);
  type R = { user_id: string; status: AssignmentStatus; due_on: string; assigned_at: string; signed_at: string | null; reminder_count: number; waive_reason: string | null; version: { version: number; document: { title: string; doc_number: string | null } } };
  const rows = (data ?? []) as unknown as R[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = ids.length ? await createAdminClient().from('profiles').select('id, full_name, email').in('id', ids) : { data: [] };
  const name = new Map((profiles ?? []).map((p) => [p.id as string, ((p.full_name as string | null) ?? (p.email as string | null) ?? '') as string]));
  const today = perthToday();
  const lines = ['Document,Number,Version,Person,Status,Due,Assigned,Signed,Reminders,Waived because'];
  for (const r of rows.sort((a, b) => a.version.document.title.localeCompare(b.version.document.title) || (name.get(a.user_id) ?? '').localeCompare(name.get(b.user_id) ?? ''))) {
    lines.push([r.version.document.title, r.version.document.doc_number, r.version.version, name.get(r.user_id), dueState(r, today), r.due_on, r.assigned_at.slice(0, 10), r.signed_at ? r.signed_at.slice(0, 10) : '', r.reminder_count, r.waive_reason].map(cell).join(','));
  }
  return new Response(lines.join('\n'), { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${project.code}_document_compliance_${today}.csv"`, 'cache-control': 'private, no-store' } });
}
