import { createAdminClient } from '@/lib/supabase/admin';
import { KIND_LABEL, orderRef, type OrderKind } from './model';
import { fmtDate } from '@/lib/pdf/dates';

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
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Site Diary <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
      to: list,
      subject: `URGENT ${kind.toLowerCase()} ${ref} — ${esc(r.item)} — ${project.name}`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px">` +
        `<p style="font-size:11px;letter-spacing:.08em;color:#9a2b2b;font-weight:bold;text-transform:uppercase">Urgent ${esc(kind.toLowerCase())}</p>` +
        `<h2 style="margin:.25em 0">${esc(ref)} · ${esc(r.item)}</h2>` +
        `<p style="margin:.25em 0">${esc(project.name)}${r.quantity ? ` · ${esc(r.quantity)}` : ''}${r.plant ? ` · ${esc(r.plant)}` : ''}${r.needed_by ? ` · needed by ${esc(fmtDate(String(r.needed_by)))}` : ''}</p>` +
        (r.notes ? `<p style="margin:.5em 0">${esc(r.notes)}</p>` : '') +
        `<p style="margin:.25em 0;color:#555">Raised by ${esc(raiser?.full_name ?? raiser?.email ?? '—')} · ${esc(fmtDate(String(r.raised_on_device_at).slice(0, 10)))}. Work stops or is unsafe without it.</p>` +
        `<p style="margin:.5em 0"><a href="${esc(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me')}/orders/${esc(r.id)}">Open it</a></p>` +
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
