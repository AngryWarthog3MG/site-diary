import { createAdminClient } from '@/lib/supabase/admin';
import { sendPush, PushConfigError } from '@/lib/push/send';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { remindDue, PRIORITY_LABEL, type ActionPriority } from './model';

/**
 * Telling the assignee (README R177). Once when an action is given to them, and nightly while it is overdue or
 * due within the week. A push to every phone they have registered; nothing is stored — the register itself is
 * the record of who holds what. Runs under the service role: the subscriptions are other people's.
 */

export interface AssignedAction { origin: string; id: string; action: string; priority: ActionPriority; due_on: string | null; assigned_to: string; project_id: string | null; record_ref: string | null }

async function pushTo(userId: string, title: string, body: string, url: string, tag: string): Promise<number> {
  const admin = createAdminClient();
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      const outcome = await sendPush({ endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string }, { title, body, url, tag });
      if (outcome === 'sent') sent += 1;
      if (outcome === 'gone') await admin.from('push_subscriptions').delete().eq('id', s.id);
    } catch (err) {
      if (err instanceof PushConfigError) return sent;
    }
  }
  return sent;
}

const line = (a: AssignedAction) => `${a.priority !== 'normal' ? `${PRIORITY_LABEL[a.priority]} · ` : ''}${a.record_ref ? `${a.record_ref} · ` : ''}${a.due_on ? `due ${fmtDate(a.due_on)}` : 'no date set'}`;
const registerUrl = (a: AssignedAction) => `/actions${a.project_id ? `?project=${a.project_id}` : ''}`;

/** On assignment: "Action for you: <what>". */
export async function notifyAssigned(a: AssignedAction, byName: string | null): Promise<number> {
  return pushTo(a.assigned_to, `Action for you: ${a.action.length > 60 ? `${a.action.slice(0, 57)}…` : a.action}`, `${line(a)}${byName ? ` · from ${byName}` : ''}`, registerUrl(a), `action-${a.origin}-${a.id}`);
}

/** Nightly: every assigned, open action that is overdue or due within the week, one push per action per night. */
export async function actionReminderSweep(): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const today = perthToday();
  const { data, error } = await admin
    .from('action_register')
    .select('origin, id, action, priority, due_on, assigned_to, project_id, record_ref, done_at')
    .is('done_at', null)
    .not('assigned_to', 'is', null)
    .not('due_on', 'is', null);
  if (error) return { error: error.message };
  const due = ((data ?? []) as Array<AssignedAction & { done_at: string | null }>).filter((a) => remindDue(a, today));
  let pushed = 0;
  for (const a of due) {
    const overdue = a.due_on != null && a.due_on < today;
    pushed += await pushTo(a.assigned_to, `${overdue ? 'Overdue' : 'Due soon'}: ${a.action.length > 60 ? `${a.action.slice(0, 57)}…` : a.action}`, line(a), registerUrl(a), `action-${a.origin}-${a.id}`);
  }
  return { due: due.length, pushed };
}
