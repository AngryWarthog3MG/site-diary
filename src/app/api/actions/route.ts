import { fail, ok, readJson, requireApiUser, isUuid, isDate } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACTION_ORIGINS, ACTION_PRIORITIES, type ActionOrigin, type ActionPriority } from '@/lib/actions/model';
import { notifyAssigned } from '@/lib/actions/notify';

export const runtime = 'nodejs';

const isOrigin = (v: unknown): v is ActionOrigin => typeof v === 'string' && (ACTION_ORIGINS as readonly string[]).includes(v);
const isPriority = (v: unknown): v is ActionPriority => typeof v === 'string' && (ACTION_PRIORITIES as readonly string[]).includes(v);
const rls = (m: string) => /row-level security/i.test(m);

async function callerName(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return (data?.full_name as string | null) ?? null;
}

/**
 * Raise a manual action (README R177): the row under the caller's RLS — the database decides who raises on a job
 * and who raises company-wide — then a push to whoever it is assigned to.
 */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const orgId = body?.orgId;
  const projectId = body?.projectId ?? null;
  const action = String(body?.action ?? '').trim();
  const detail = String(body?.detail ?? '').trim() || null;
  const priority = body?.priority ?? 'normal';
  const assignedTo = body?.assignedTo ?? null;
  const dueOn = body?.dueOn ?? null;
  const ownerName = String(body?.ownerName ?? '').trim() || null;
  if (!isUuid(orgId) || (projectId !== null && !isUuid(projectId)) || (assignedTo !== null && !isUuid(assignedTo))) return fail('bad_request', 'Bad ids.', 400);
  if (!action) return fail('bad_request', 'Say what has to be done.', 400);
  if (action.length > 500) return fail('bad_request', 'Keep the action under 500 characters; the detail has room for the rest.', 400);
  if (!isPriority(priority)) return fail('bad_request', 'Priority is normal, high or critical.', 400);
  if (dueOn !== null && !isDate(dueOn)) return fail('bad_request', 'Bad due date.', 400);

  const { data: row, error } = await supabase
    .from('actions')
    .insert({ org_id: orgId, project_id: projectId, action, detail, priority, assigned_to: assignedTo, due_on: dueOn, owner_name: ownerName, raised_by: user.id })
    .select('id, action, priority, due_on, assigned_to, project_id')
    .single();
  if (error) return fail(rls(error.message) ? 'forbidden' : 'bad_request', rls(error.message) ? (projectId ? 'Only someone who runs the site raises an action on a job.' : 'Only the office raises a company-wide action.') : error.message, rls(error.message) ? 403 : 400);

  let pushed = 0;
  if (row.assigned_to && row.assigned_to !== user.id) {
    pushed = await notifyAssigned({ origin: 'manual', id: row.id, action: row.action, priority: row.priority, due_on: row.due_on, assigned_to: row.assigned_to, project_id: row.project_id, record_ref: null }, await callerName(user.id));
  }
  return ok({ id: row.id, pushed });
}

/**
 * Change who holds an action of any origin, its priority, due date or owner — or mark it done. `update_action`
 * and `complete_action` run as the caller, so each table's policy and freeze decide; a refused row is "not on
 * the file" whichever reason. A new assignee is told.
 */
export async function PATCH(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const origin = body?.origin;
  const id = body?.id;
  if (!isOrigin(origin) || !isUuid(id)) return fail('bad_request', 'Bad ids.', 400);

  if (body?.done === true) {
    const note = String(body?.note ?? '').trim() || null;
    const { error } = await supabase.rpc('complete_action', { p_origin: origin, p_id: id, p_note: note });
    if (error) return fail('bad_request', error.message, 400);
    return ok({ done: true });
  }

  const assignedTo = body?.assignedTo ?? null;
  const priority = body?.priority ?? 'normal';
  const dueOn = body?.dueOn ?? null;
  const ownerName = String(body?.ownerName ?? '').trim() || null;
  if (assignedTo !== null && !isUuid(assignedTo)) return fail('bad_request', 'Bad ids.', 400);
  if (!isPriority(priority)) return fail('bad_request', 'Priority is normal, high or critical.', 400);
  if (dueOn !== null && !isDate(dueOn)) return fail('bad_request', 'Bad due date.', 400);

  // Who held it before, so only a NEW assignee is told.
  const { data: before } = await supabase.from('action_register').select('assigned_to').eq('origin', origin).eq('id', id).maybeSingle();
  const { error } = await supabase.rpc('update_action', { p_origin: origin, p_id: id, p_assigned_to: assignedTo, p_priority: priority, p_due_on: dueOn, p_owner_name: ownerName });
  if (error) return fail('bad_request', error.message, 400);

  let pushed = 0;
  if (assignedTo && assignedTo !== user.id && assignedTo !== (before?.assigned_to ?? null)) {
    const { data: after } = await supabase.from('action_register').select('origin, id, action, priority, due_on, assigned_to, project_id, record_ref').eq('origin', origin).eq('id', id).maybeSingle();
    if (after?.assigned_to) pushed = await notifyAssigned(after as Parameters<typeof notifyAssigned>[0], await callerName(user.id));
  }
  return ok({ updated: true, pushed });
}

/** Whoever raised a manual action removes it while it is open; nothing else is ever deleted here. */
export async function DELETE(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const id = body?.id;
  if (!isUuid(id)) return fail('bad_request', 'Bad ids.', 400);
  const { data, error } = await supabase.from('actions').delete().eq('id', id).select('id');
  if (error) return fail('bad_request', error.message, 400);
  if (!data || data.length === 0) return fail('forbidden', 'Only whoever raised an open action removes it.', 403);
  return ok({ deleted: true });
}
