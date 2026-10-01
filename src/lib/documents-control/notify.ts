import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPush } from '@/lib/push/send';
import { siteUrl } from '@/lib/site-url';
import { fmtDate } from '@/lib/pdf/dates';

/**
 * Telling people a document is waiting on them (README R120): on issue, and
 * as a reminder three days before it is due and while it is overdue. Each
 * person gets a push to every phone they have registered and an email; the
 * assignment is stamped so nobody is reminded twice in 48 hours. Runs under
 * the service role — the subscriptions and addresses are other people's.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export interface Assignee { assignmentId: string; userId: string; dueOn: string }

export interface NotifyOutcome { people: number; pushed: number; emailed: number }

export async function notifyAssignees(
  admin: SupabaseClient,
  input: { versionId: string; documentId: string; title: string; version: number; reason: 'issued' | 'reminder'; assignees: Assignee[]; alreadyStamped?: ReadonlySet<string> },
): Promise<NotifyOutcome> {
  if (input.assignees.length === 0) return { people: 0, pushed: 0, emailed: 0 };
  const ids = input.assignees.map((a) => a.userId);
  const [{ data: subs }, { data: profiles }] = await Promise.all([
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', ids),
    admin.from('profiles').select('id, email, full_name').in('id', ids),
  ]);
  const byUser = new Map((profiles ?? []).map((p) => [p.id as string, p as { email: string | null; full_name: string | null }]));
  const site = siteUrl();
  const key = process.env.SMTP_PASS?.trim();
  let pushed = 0; let emailed = 0;
  for (const a of input.assignees) {
    const due = fmtDate(a.dueOn);
    const overdue = a.dueOn < new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const title = input.reason === 'issued' ? `Read and sign: ${input.title}` : overdue ? `Overdue: ${input.title}` : `Reminder: ${input.title}`;
    const line = input.reason === 'issued' ? `Version ${input.version} is issued. Read it and sign by ${due}.` : overdue ? `It was due ${due}. Read it and sign today.` : `Read it and sign by ${due}.`;
    const url = `/procedures/${input.documentId}`;
    for (const s of (subs ?? []).filter((x) => x.user_id === a.userId)) {
      const outcome = await sendPush({ endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string }, { title, body: line, url, tag: `document-${input.versionId}` }).catch(() => 'failed' as const);
      if (outcome === 'sent') pushed += 1;
      if (outcome === 'gone') await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
    const who = byUser.get(a.userId);
    if (key && who?.email) {
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Kooboolong IMS <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`, to: [who.email],
          subject: `${title} — Kooboolong IMS`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;font-size:16px;line-height:1.5"><p>${who.full_name ? `Hi ${esc(who.full_name)},` : 'Hi,'}</p><p>${esc(line)}</p><p><a href="${esc(site)}${url}">Open ${esc(input.title)}</a> in Kooboolong IMS, read it to the end, and sign that you have understood it.</p></div>`,
        }),
      }).catch(() => null);
      if (send?.ok) emailed += 1;
    }
    if (input.reason === 'reminder' && !input.alreadyStamped?.has(a.assignmentId)) await admin.rpc('record_document_reminder', { p_assignment: a.assignmentId });
  }
  if (input.reason === 'issued') await admin.rpc('record_document_notified', { p_version: input.versionId, p_detail: `${input.assignees.length} people · ${pushed} phones · ${emailed} emails` });
  return { people: input.assignees.length, pushed, emailed };
}

/** The version's pending assignees, optionally only some of them. */
export async function pendingAssignees(admin: SupabaseClient, versionId: string, userIds?: string[]): Promise<Assignee[]> {
  let q = admin.from('document_assignments').select('id, user_id, due_on').eq('version_id', versionId).eq('status', 'pending');
  if (userIds && userIds.length > 0) q = q.in('user_id', userIds);
  const { data } = await q;
  return (data ?? []).map((r) => ({ assignmentId: r.id as string, userId: r.user_id as string, dueOn: r.due_on as string }));
}
