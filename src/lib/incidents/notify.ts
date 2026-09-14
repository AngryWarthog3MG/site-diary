import { createAdminClient } from '@/lib/supabase/admin';
import { KIND_LABEL, SEVERITY_LABEL, incidentRef, urgent, type IncidentKind, type Severity } from './model';
import { fmtDate } from '@/lib/pdf/dates';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type NotifyOutcome = { sent: true; to: number } | { sent: false; reason: 'already' | 'not urgent' | 'no addresses' | 'not found' | 'send failed' };

/**
 * Tell the office about one report — once. The service role claims the
 * report (notified_at) before sending, so two calls at once cannot both
 * send; a failed send hands the claim back so the nightly retry can take
 * it. Everything a person typed is escaped before it becomes HTML.
 */
export async function notifyOffice(incidentId: string): Promise<NotifyOutcome> {
  const admin = createAdminClient();
  const { data: r } = await admin
    .from('incidents')
    .select('id, seq, kind, occurred_at, location, description, injured_name, actual_severity, potential_severity, notifiable, notified_at, project:projects!inner(name, code, report_emails), reporter:profiles!incidents_reported_by_profiles_fkey(full_name, email)')
    .eq('id', incidentId)
    .maybeSingle();
  if (!r) return { sent: false, reason: 'not found' };
  if (r.notified_at) return { sent: false, reason: 'already' };
  const project = (Array.isArray(r.project) ? r.project[0] : r.project) as { name: string; code: string; report_emails: string[] | null };
  const list = project.report_emails ?? [];
  const isUrgent = urgent({ kind: r.kind as IncidentKind, notifiable: r.notifiable, actual_severity: r.actual_severity as Severity | null, potential_severity: r.potential_severity as Severity | null });
  if (!isUrgent) return { sent: false, reason: 'not urgent' };
  if (list.length === 0) return { sent: false, reason: 'no addresses' };

  // Claim it first: exactly one caller gets to send.
  const { data: claimed } = await admin.from('incidents').update({ notified_at: new Date().toISOString() }).eq('id', incidentId).is('notified_at', null).select('id');
  if (!claimed || claimed.length === 0) return { sent: false, reason: 'already' };

  const reporter = (Array.isArray(r.reporter) ? r.reporter[0] : r.reporter) as { full_name?: string | null; email?: string | null } | null;
  const ref = incidentRef(r.seq);
  const kindLabel = KIND_LABEL[r.kind as IncidentKind];
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Site Diary <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
      to: list,
      subject: `${r.notifiable ? 'NOTIFIABLE — ' : ''}${kindLabel} ${ref} — ${project.name}`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px">` +
        `<p style="font-size:11px;letter-spacing:.08em;color:#9a2b2b;font-weight:bold;text-transform:uppercase">${r.notifiable ? 'Notifiable incident' : 'Safety report'}</p>` +
        `<h2 style="margin:.25em 0">${esc(ref)} · ${esc(kindLabel)}</h2>` +
        `<p style="margin:.25em 0">${esc(project.name)} · ${esc(fmtDate(String(r.occurred_at).slice(0, 10)))}${r.location ? ` · ${esc(r.location)}` : ''}</p>` +
        `<p style="margin:.5em 0">${esc(r.description)}</p>` +
        (r.injured_name ? `<p style="margin:.25em 0"><b>Person hurt:</b> ${esc(r.injured_name)}</p>` : '') +
        `<p style="margin:.25em 0;color:#555">Severity: ${r.actual_severity ? SEVERITY_LABEL[r.actual_severity as Severity] : '—'} actual, ${r.potential_severity ? SEVERITY_LABEL[r.potential_severity as Severity] : '—'} potential. Reported by ${esc(reporter?.full_name ?? reporter?.email ?? '—')}.</p>` +
        (r.notifiable ? `<p style="margin:.5em 0;color:#9a2b2b"><b>WorkSafe WA must be notified immediately by phone.</b></p>` : '') +
        `<p style="margin:.5em 0"><a href="${esc(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me')}/incidents/${esc(r.id)}">Open the report</a></p>` +
        `</div>`,
    }),
  }).catch(() => null);
  if (!send || !send.ok) {
    // Hand the claim back so the button and the nightly retry can try again.
    await admin.from('incidents').update({ notified_at: null }).eq('id', incidentId);
    return { sent: false, reason: 'send failed' };
  }
  return { sent: true, to: list.length };
}

/** Urgent reports the office has not heard about — the nightly safety net and the screen's badge. */
export async function unnotifiedUrgent(): Promise<Array<{ id: string; seq: number; project: string }>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('incidents')
    .select('id, seq, kind, notifiable, actual_severity, potential_severity, reported_at, project:projects!inner(code, report_emails)')
    .is('notified_at', null)
    .neq('status', 'closed')
    .lt('reported_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => urgent({ kind: r.kind as IncidentKind, notifiable: Boolean(r.notifiable), actual_severity: (r.actual_severity as Severity | null) ?? null, potential_severity: (r.potential_severity as Severity | null) ?? null }))
    .filter((r) => { const p = (Array.isArray(r.project) ? r.project[0] : r.project) as { report_emails: string[] | null }; return (p.report_emails ?? []).length > 0; })
    .map((r) => ({ id: r.id as string, seq: r.seq as number, project: ((Array.isArray(r.project) ? r.project[0] : r.project) as { code: string }).code }));
}
