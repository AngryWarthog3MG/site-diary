import type { SupabaseClient } from '@supabase/supabase-js';
import { wantsReminder, type AssignmentStatus } from './model';
import { notifyAssignees } from './notify';

/**
 * The nightly reminder sweep (README R120): every pending assignment on a
 * current version that is three days from due, or overdue, and has not been
 * reminded in 48 hours. Grouped by version so one person with three documents
 * gets three notes, each naming its document. Service role.
 */
export async function documentReminderSweep(admin: SupabaseClient, now = new Date()): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('document_assignments')
    .select('id, user_id, due_on, status, last_reminded_at, version:document_versions!inner(id, version, status, document:controlled_documents!inner(id, title, active))')
    .eq('status', 'pending');
  if (error) return { error: error.message };
  type Row = { id: string; user_id: string; due_on: string; status: AssignmentStatus; last_reminded_at: string | null; version: { id: string; version: number; status: string; document: { id: string; title: string; active: boolean } } };
  const due = ((data ?? []) as unknown as Row[]).filter((r) => r.version.status === 'current' && r.version.document.active && wantsReminder(r, now));
  const byVersion = new Map<string, Row[]>();
  for (const r of due) byVersion.set(r.version.id, [...(byVersion.get(r.version.id) ?? []), r]);
  const out: Array<{ title: string; people: number; pushed: number; emailed: number }> = [];
  for (const rows of byVersion.values()) {
    const v = rows[0].version;
    const res = await notifyAssignees(admin, {
      versionId: v.id, documentId: v.document.id, title: v.document.title, version: v.version, reason: 'reminder',
      assignees: rows.map((r) => ({ assignmentId: r.id, userId: r.user_id, dueOn: r.due_on })),
    });
    out.push({ title: v.document.title, ...res });
  }
  return { reminded: due.length, documents: out };
}
