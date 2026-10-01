import type { SupabaseClient } from '@supabase/supabase-js';
import { complianceSummary, dueState, type AssignmentStatus, type DueState } from './model';

/**
 * Document control, read under the caller's RLS (README R120). The list, the
 * compliance overview and the home's Waiting on you panel all come through
 * here, so a figure on one is the figure on the others.
 */

export interface AssignmentRow {
  id: string;
  version_id: string;
  user_id: string;
  status: AssignmentStatus;
  due_on: string;
  signed_at: string | null;
  acknowledgement_id: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
  waive_reason: string | null;
}

export interface DocumentOverviewRow {
  id: string;
  title: string;
  kind: string;
  doc_number: string | null;
  requires_acknowledgement: boolean;
  active: boolean;
  audience: string[];
  ack_due_days: number;
  next_review_on: string | null;
  current: { id: string; version: number; issued_at: string | null } | null;
  draft: { id: string; version: number } | null;
  summary: ReturnType<typeof complianceSummary>;
  /** The caller's own assignment on the current version, when they have one. */
  mine: (AssignmentRow & { state: DueState }) | null;
}

export async function loadDocumentsOverview(supabase: SupabaseClient, orgId: string, userId: string, today: string): Promise<DocumentOverviewRow[]> {
  const { data, error } = await supabase
    .from('controlled_documents')
    .select('id, title, kind, doc_number, requires_acknowledgement, active, audience, ack_due_days, next_review_on, document_versions(id, version, status, issued_at, document_assignments(id, version_id, user_id, status, due_on, signed_at, acknowledgement_id, last_reminded_at, reminder_count, waive_reason))')
    .eq('org_id', orgId)
    .order('title');
  if (error) throw new Error(`Could not read the documents: ${error.message}`);
  type V = { id: string; version: number; status: string; issued_at: string | null; document_assignments: AssignmentRow[] | null };
  return ((data ?? []) as Array<Record<string, unknown> & { document_versions: V[] | null }>).map((d) => {
    const versions = d.document_versions ?? [];
    const current = versions.find((v) => v.status === 'current') ?? null;
    const draft = versions.find((v) => v.status === 'draft') ?? null;
    const assignments = current?.document_assignments ?? [];
    const mine = assignments.find((a) => a.user_id === userId) ?? null;
    return {
      id: d.id as string, title: d.title as string, kind: d.kind as string, doc_number: (d.doc_number as string | null) ?? null,
      requires_acknowledgement: Boolean(d.requires_acknowledgement), active: Boolean(d.active), audience: (d.audience as string[] | null) ?? [],
      ack_due_days: d.ack_due_days as number, next_review_on: (d.next_review_on as string | null) ?? null,
      current: current ? { id: current.id, version: current.version, issued_at: current.issued_at } : null,
      draft: draft ? { id: draft.id, version: draft.version } : null,
      summary: complianceSummary(assignments, today),
      mine: mine ? { ...mine, state: dueState(mine, today) } : null,
    };
  });
}

export interface WaitingItem {
  kind: 'document';
  id: string;
  documentId: string;
  title: string;
  version: number;
  due_on: string;
  state: DueState;
  questions: boolean;
}

/** What is waiting on this person: their pending document assignments, soonest first. */
export async function loadWaitingOnMe(supabase: SupabaseClient, userId: string, today: string): Promise<WaitingItem[]> {
  const { data } = await supabase
    .from('document_assignments')
    .select('id, due_on, status, version:document_versions!inner(id, version, status, document:controlled_documents!inner(id, title, active), document_questions(id))')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('due_on');
  type Row = { id: string; due_on: string; status: AssignmentStatus; version: { id: string; version: number; status: string; document: { id: string; title: string; active: boolean }; document_questions: Array<{ id: string }> | null } };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.version.status === 'current' && r.version.document.active)
    .map((r) => ({
      kind: 'document' as const, id: r.id, documentId: r.version.document.id, title: r.version.document.title, version: r.version.version,
      due_on: r.due_on, state: dueState({ status: r.status, due_on: r.due_on }, today), questions: (r.version.document_questions ?? []).length > 0,
    }));
}
