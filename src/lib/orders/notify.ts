import { createAdminClient } from '@/lib/supabase/admin';
import { KIND_LABEL, orderRef, watchDue, hoursOpen, type OrderKind, type OrderStatus } from './model';
import { sendPush, PushConfigError } from '@/lib/push/send';
import { siteUrl } from '@/lib/site-url';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type NotifyOutcome = { sent: true; to: number } | { sent: false; reason: 'already' | 'not urgent' | 'no addresses' | 'not found' | 'send failed' };

/**
 * Tell the office about one urgent order or plant issue — once. The same
 * shape as the incident email: the service role claims the request
 * (notified_at) before sending so two callers cannot both send, and a failed
 * send hands the claim back for the nightly retry. Typed text is escaped.
 */
export async function notifyOfficeOrder(orderId: string): Promise<NotifyOutcome> {
  const admin = createAdminClient();
  const { data: r } = await admin
    .from('orders')
    .select('id, seq, kind, item, quantity, plant, needed_by, urgent, notes, status, notified_at, raised_on_device_at, project:projects!inner(name, code, report_emails), raiser:profiles!orders_raised_by_profiles_fkey(full_name, email)')
    .eq('id', orderId)
    .maybeSingle();
  if (!r) return { sent: false, reason: 'not found' };
  if (r.notified_at) return { sent: false, reason: 'already' };
  if (!r.urgent) return { sent: false, reason: 'not urgent' };
  const project = (Array.isArray(r.project) ? r.project[0] : r.project) as { name: string; code: string; report_emails: string[] | null };
  const list = project.report_emails ?? [];
  if (list.length === 0) return { sent: false, reason: 'no addresses' };

  const { data: claimed } = await admin.from('orders').update({ notified_at: new Date().toISOString() }).eq('id', orderId).is('notified_at', null).select('id');
  if (!claimed || claimed.length === 0) return { sent: false, reason: 'already' };

  const raiser = (Array.isArray(r.raiser) ? r.raiser[0] : r.raiser) as { full_name?: string | null; email?: string | null } | null;
  const ref = orderRef(r.seq);
  const kind = KIND_LABEL[r.kind as OrderKind];
  // Bounded: a call that hangs until the platform kills the function would leave the claim
  // (notified_at) set with nothing sent, and the nightly retry would skip it as done.
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Kooboolong IMS <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
      to: list,
      subject: `URGENT ${kind.toLowerCase()} ${ref} — ${esc(r.item)} — ${project.name}`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px">` +
        `<p style="font-size:11px;letter-spacing:.08em;color:#9a2b2b;font-weight:bold;text-transform:uppercase">Urgent ${esc(kind.toLowerCase())}</p>` +
        `<h2 style="margin:.25em 0">${esc(ref)} · ${esc(r.item)}</h2>` +
        `<p style="margin:.25em 0">${esc(project.name)}${r.quantity ? ` · ${esc(r.quantity)}` : ''}${r.plant ? ` · ${esc(r.plant)}` : ''}${r.needed_by ? ` · needed by ${esc(fmtDate(String(r.needed_by)))}` : ''}</p>` +
        (r.notes ? `<p style="margin:.5em 0">${esc(r.notes)}</p>` : '') +
        `<p style="margin:.25em 0;color:#555">Raised by ${esc(raiser?.full_name ?? raiser?.email ?? '—')} · ${esc(fmtPerthDate(String(r.raised_on_device_at)))}. Work stops or is unsafe without it.</p>` +
        `<p style="margin:.5em 0"><a href="${esc(siteUrl())}/orders/${esc(r.id)}">Open it</a></p>` +
        `</div>`,
    }),
  }).catch(() => null);
  if (!send || !send.ok) {
    await admin.from('orders').update({ notified_at: null }).eq('id', orderId);
    return { sent: false, reason: 'send failed' };
  }
  return { sent: true, to: list.length };
}

/** Urgent requests still live that the office has not heard about — the nightly safety net. */
export async function unnotifiedUrgentOrders(): Promise<Array<{ id: string; seq: number; project: string }>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('orders')
    .select('id, seq, project:projects!inner(code, report_emails)')
    .eq('urgent', true)
    .is('notified_at', null)
    .in('status', ['open', 'ordered'])
    .lt('raised_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  return ((data ?? []) as Array<{ id: string; seq: number; project: { code: string; report_emails: string[] | null } | Array<{ code: string; report_emails: string[] | null }> }>)
    .map((r) => ({ id: r.id, seq: r.seq, p: Array.isArray(r.project) ? r.project[0] : r.project }))
    .filter((r) => (r.p.report_emails ?? []).length > 0)
    .map((r) => ({ id: r.id, seq: r.seq, project: r.p.code }));
}

type WatchRow = {
  id: string; seq: number; kind: string; item: string; quantity: string | null; plant: string | null; needed_by: string | null; urgent: boolean; notes: string | null;
  status: string; raised_at: string; raised_on_device_at: string; watchers_notified_at: string | null; last_reminded_at: string | null;
  project: { name: string; code: string; org_id: string } | Array<{ name: string; code: string; org_id: string }>;
  raiser: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
};
const WATCH_COLS = 'id, seq, kind, item, quantity, plant, needed_by, urgent, notes, status, raised_at, raised_on_device_at, watchers_notified_at, last_reminded_at, project:projects!inner(name, code, org_id), raiser:profiles!orders_raised_by_profiles_fkey(full_name)';

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Kooboolong IMS <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`, to: [to], subject, html }),
  }).catch(() => null);
  return Boolean(res && res.ok);
}

export interface WatchOutcome { order: string; mode: 'first' | 'reminder'; watchers: number; pushed: number; emailed: number }

/**
 * Tell the company's watchers about one request (README R165): on every phone they have the app on, and by email —
 * the first time it is raised, then as a reminder while it stays open or ordered. The stamp is the server's and is set
 * before sending, so two callers cannot both send; a send that reaches nobody hands the stamp back for the next sweep.
 */
export async function notifyWatchers(orderId: string, mode: 'first' | 'reminder', nowIso = new Date().toISOString()): Promise<WatchOutcome | { skipped: string }> {
  const admin = createAdminClient();
  const { data: r } = await admin.from('orders').select(WATCH_COLS).eq('id', orderId).maybeSingle();
  if (!r) return { skipped: 'not found' };
  const o = r as unknown as WatchRow;
  const project = Array.isArray(o.project) ? o.project[0] : o.project;
  const { data: watchers } = await admin.from('order_watchers').select('user_id, every_hours').eq('org_id', project.org_id);
  if (!watchers?.length) return { skipped: 'no watchers' };
  const due = watchDue({ status: o.status as OrderStatus, raised_at: o.raised_at, watchers_notified_at: o.watchers_notified_at, last_reminded_at: o.last_reminded_at }, nowIso, Math.min(...watchers.map((w) => Number(w.every_hours) || 6)));
  if (mode === 'first' && o.watchers_notified_at) return { skipped: 'already told' };
  if (mode === 'reminder' && due !== 'reminder') return { skipped: due === 'first' ? 'not yet told' : 'not due' };
  // Claim the stamp first.
  const stamp = mode === 'first' ? { watchers_notified_at: nowIso } : { last_reminded_at: nowIso };
  const claim = admin.from('orders').update(stamp).eq('id', orderId);
  const { data: claimed } = mode === 'first' ? await claim.is('watchers_notified_at', null).select('id') : await claim.select('id');
  if (!claimed?.length) return { skipped: 'already told' };

  const raiser = (Array.isArray(o.raiser) ? o.raiser[0] : o.raiser)?.full_name ?? 'someone on site';
  const ref = orderRef(o.seq);
  const kind = KIND_LABEL[o.kind as OrderKind];
  const open = hoursOpen(o.raised_at, nowIso);
  const title = mode === 'first'
    ? `${o.urgent ? 'URGENT ' : ''}${kind} ${ref} — ${project.code}`
    : `Still ${o.status === 'ordered' ? 'ordered, not done' : 'open'}: ${kind.toLowerCase()} ${ref} — ${project.code}`;
  const line = `${o.item}${o.quantity ? ` · ${o.quantity}` : ''}${o.plant ? ` · ${o.plant}` : ''}${o.needed_by ? ` · needed by ${fmtDate(String(o.needed_by))}` : ''}`;
  const body = mode === 'first' ? `${line}. Raised by ${raiser}.` : `${line}. Raised by ${raiser} ${open} h ago; nobody has closed it out.`;
  const url = `/orders/${o.id}`;
  let pushed = 0; let emailed = 0;
  for (const w of watchers) {
    const [{ data: subs }, { data: who }] = await Promise.all([
      admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', w.user_id),
      admin.from('profiles').select('full_name, email').eq('id', w.user_id).maybeSingle(),
    ]);
    for (const s of subs ?? []) {
      try {
        const outcome = await sendPush({ endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string }, { title, body: body.length > 180 ? `${body.slice(0, 177)}…` : body, url, tag: `order-${o.id}-${mode}` });
        if (outcome === 'sent') pushed += 1;
        if (outcome === 'gone') await admin.from('push_subscriptions').delete().eq('id', s.id);
      } catch (e) { if (!(e instanceof PushConfigError)) throw e; }
    }
    const email = (who?.email as string | null) ?? null;
    if (email) {
      const ok = await sendEmail(email, title, `<div style="font-family:Arial,sans-serif;max-width:560px"><p style="font-size:11px;letter-spacing:.08em;color:${o.urgent ? '#9a2b2b' : '#555'};font-weight:bold;text-transform:uppercase">${esc(mode === 'first' ? `New ${kind.toLowerCase()}` : `Reminder · ${open} hours open`)}</p><h2 style="margin:.25em 0">${esc(ref)} · ${esc(o.item)}</h2><p style="margin:.25em 0">${esc(project.name)}${o.quantity ? ` · ${esc(o.quantity)}` : ''}${o.plant ? ` · ${esc(o.plant)}` : ''}${o.needed_by ? ` · needed by ${esc(fmtDate(String(o.needed_by)))}` : ''}</p>${o.notes ? `<p style="margin:.5em 0">${esc(o.notes)}</p>` : ''}<p style="margin:.25em 0;color:#555">Raised by ${esc(raiser)} · ${esc(fmtPerthDate(String(o.raised_on_device_at)))}${mode === 'reminder' ? ` · still ${esc(o.status)} after ${open} hours` : ''}.</p><p style="margin:.5em 0"><a href="${esc(siteUrl())}${esc(url)}">Open it</a> · you are told of every request and reminded while it stays open; turn it off on the Orders page.</p></div>`);
      if (ok) emailed += 1;
    }
  }
  if (pushed === 0 && emailed === 0) {
    // Nobody reached: hand the stamp back so the sweep tries again.
    await admin.from('orders').update(mode === 'first' ? { watchers_notified_at: null } : { last_reminded_at: o.last_reminded_at }).eq('id', orderId);
  }
  return { order: ref, mode, watchers: watchers.length, pushed, emailed };
}

/** The sweep (README R165): every open or ordered request on a company with watchers — the first word if it was missed, a reminder when one is due. */
export async function orderWatchSweep(nowIso = new Date().toISOString()): Promise<Array<WatchOutcome | { order: string; skipped: string }>> {
  const admin = createAdminClient();
  const { data: orgs } = await admin.from('order_watchers').select('org_id, every_hours');
  if (!orgs?.length) return [];
  const every = new Map<string, number>();
  for (const w of orgs) every.set(w.org_id, Math.min(every.get(w.org_id) ?? 999, Number(w.every_hours) || 6));
  const { data: rows } = await admin.from('orders').select(WATCH_COLS).in('status', ['open', 'ordered']).order('raised_at');
  const out: Array<WatchOutcome | { order: string; skipped: string }> = [];
  for (const r of (rows ?? []) as unknown as WatchRow[]) {
    const project = Array.isArray(r.project) ? r.project[0] : r.project;
    const hours = every.get(project.org_id);
    if (!hours) continue;
    const due = watchDue({ status: r.status as OrderStatus, raised_at: r.raised_at, watchers_notified_at: r.watchers_notified_at, last_reminded_at: r.last_reminded_at }, nowIso, hours);
    if (!due) continue;
    const res = await notifyWatchers(r.id, due, nowIso);
    out.push('skipped' in res ? { order: orderRef(r.seq), skipped: res.skipped } : res);
  }
  return out;
}
