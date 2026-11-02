import type { SupabaseClient } from '@supabase/supabase-js';
import { ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { sortActions, summarise, type RegisterRow, type ActionSummary } from './model';

/**
 * The action register, read under the caller's RLS through `public.action_register` (README R177): this job's
 * actions of every origin plus the company-wide ones, with the names behind the account ids. Nothing is computed
 * here that the view does not already carry; the model sorts and counts.
 */

export interface RegisterPerson { id: string; name: string; roles: string[] }

export interface ActionRegisterData {
  rows: Array<RegisterRow & { assignee: string | null; raiser: string | null; closer: string | null }>;
  summary: ActionSummary;
  /** Everyone on the job, for the assignee dropdown — the office too, since company-wide actions go to them. */
  people: RegisterPerson[];
}

export async function loadActionRegister(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string,
  today: string,
  userId: string | null,
  opts: { includeDone?: boolean } = {},
): Promise<ActionRegisterData> {
  let q = supabase
    .from('action_register')
    .select('origin, id, org_id, project_id, record_id, record_ref, record_title, action, detail, priority, owner_name, assigned_to, due_on, done_at, done_by, done_note, raised_by, raised_at')
    .eq('org_id', orgId)
    .or(`project_id.eq.${projectId},project_id.is.null`);
  if (!opts.includeDone) q = q.is('done_at', null);
  const [{ data: rowsRaw, error }, { data: members }] = await Promise.all([
    q.limit(1000),
    supabase.from('project_members').select('user_id, role, project:projects!inner(id, org_id, active)').eq('project.org_id', orgId),
  ]);
  if (error) throw new Error(error.message);
  const rows = (rowsRaw ?? []) as RegisterRow[];

  type M = { user_id: string; role: MemberRole; project: { id: string; active: boolean } | { id: string; active: boolean }[] };
  const onJob = new Map<string, Set<string>>();
  for (const m of (members ?? []) as unknown as M[]) {
    const p = Array.isArray(m.project) ? m.project[0] : m.project;
    if (!p.active) continue;
    // Someone on THIS job, or the office anywhere in the company (a company-wide action is theirs to take).
    const office = m.role === 'pm' || m.role === 'admin';
    if (p.id !== projectId && !office) continue;
    const e = onJob.get(m.user_id) ?? new Set<string>();
    e.add(ROLE_LABEL[m.role] ?? m.role);
    onJob.set(m.user_id, e);
  }
  const ids = new Set<string>([...onJob.keys()]);
  for (const r of rows) { if (r.assigned_to) ids.add(r.assigned_to); if (r.raised_by) ids.add(r.raised_by); if (r.done_by) ids.add(r.done_by); }
  const { data: profiles } = ids.size ? await supabase.from('profiles').select('id, full_name, email').in('id', [...ids]) : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const nameOf = new Map<string, string>();
  for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) nameOf.set(p.id, p.full_name ?? p.email ?? 'Unnamed');

  const people: RegisterPerson[] = [...onJob.entries()]
    .map(([id, roles]) => ({ id, name: nameOf.get(id) ?? 'Unnamed', roles: [...roles] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sorted = sortActions(rows, today).map((r) => ({
    ...r,
    assignee: r.assigned_to ? nameOf.get(r.assigned_to) ?? 'Someone' : null,
    raiser: r.raised_by ? nameOf.get(r.raised_by) ?? null : null,
    closer: r.done_by ? nameOf.get(r.done_by) ?? null : null,
  }));
  return { rows: sorted, summary: summarise(rows, today, userId), people };
}
