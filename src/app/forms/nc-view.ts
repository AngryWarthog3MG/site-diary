import type { NcRow } from '@/lib/forms/load';
import type { NcView } from './nc-list';

/** A register row with the names in, for the list. */
export function toNcView(n: NcRow, nameOf: Map<string, string>): NcView {
  return {
    id: n.id, submission_id: n.submission_id, question_label: n.question_label, answer: n.answer, note: n.note, photo_count: n.photo_paths.length,
    status: n.status, resolution: n.resolution, resolved_at: n.resolved_at, resolver: n.resolved_by ? nameOf.get(n.resolved_by) ?? null : null,
    removed_reason: n.removed_reason, raised_as_action: n.raised_as_action, action: n.action, priority: n.priority, owner_name: n.owner_name,
    assignee: n.assigned_to ? nameOf.get(n.assigned_to) ?? null : null, due_on: n.due_on, created_at: n.created_at,
    form: n.form ? { code: n.form.template_code, title: n.form.template_title, completed_at: n.form.completed_at, subject_person: n.form.subject_person } : null,
  };
}
