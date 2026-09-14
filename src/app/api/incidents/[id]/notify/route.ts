import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { KIND_LABEL, SEVERITY_LABEL, incidentRef, urgent, type IncidentKind, type Severity } from '@/lib/incidents/model';
import { fmtDate } from '@/lib/pdf/dates';

/**
 * Tell the office. Called once a report lands (live, or replayed from the
 * outbox). Urgent reports — injuries, notifiable, high severity — go to the
 * project's report addresses at once; the rest wait for the register. Sent
 * once: notified_at is stamped by the service role so a retry cannot spam.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad report id.', 400);
  const { data: r } = await supabase
    .from('incidents')
    .select('id, seq, kind, occurred_at, location, description, injured_name, actual_severity, potential_severity, notifiable, notified_at, project:projects!inner(name, code, report_emails), reporter:profiles!incidents_reported_by_profiles_fkey(full_name, email)')
    .eq('id', id)
    .maybeSingle();
  if (!r) return fail('not_found', 'Not your report.', 404);
  if (r.notified_at) return ok({ sent: false, reason: 'already' });
  const project = (Array.isArray(r.project) ? r.project[0] : r.project) as { name: string; code: string; report_emails: string[] | null };
  const list = project.report_emails ?? [];
  const isUrgent = urgent({ kind: r.kind as IncidentKind, notifiable: r.notifiable, actual_severity: r.actual_severity as Severity | null, potential_severity: r.potential_severity as Severity | null });
  if (!isUrgent || list.length === 0) return ok({ sent: false, reason: isUrgent ? 'no addresses' : 'not urgent' });
  const reporter = (Array.isArray(r.reporter) ? r.reporter[0] : r.reporter) as { full_name?: string | null; email?: string | null } | null;
  const ref = incidentRef(r.seq);
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Site Diary <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
      to: list,
      subject: `${r.notifiable ? 'NOTIFIABLE — ' : ''}${KIND_LABEL[r.kind as IncidentKind]} ${ref} — ${project.name}`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px">` +
        `<p style="font-size:11px;letter-spacing:.08em;color:#9a2b2b;font-weight:bold;text-transform:uppercase">${r.notifiable ? 'Notifiable incident' : 'Safety report'}</p>` +
        `<h2 style="margin:.25em 0">${ref} · ${KIND_LABEL[r.kind as IncidentKind]}</h2>` +
        `<p style="margin:.25em 0">${project.name} · ${fmtDate(String(r.occurred_at).slice(0, 10))}${r.location ? ` · ${r.location}` : ''}</p>` +
        `<p style="margin:.5em 0">${String(r.description).replace(/</g, '&lt;')}</p>` +
        (r.injured_name ? `<p style="margin:.25em 0"><b>Person hurt:</b> ${String(r.injured_name).replace(/</g, '&lt;')}</p>` : '') +
        `<p style="margin:.25em 0;color:#555">Severity: ${r.actual_severity ? SEVERITY_LABEL[r.actual_severity as Severity] : '—'} actual, ${r.potential_severity ? SEVERITY_LABEL[r.potential_severity as Severity] : '—'} potential. Reported by ${reporter?.full_name ?? reporter?.email ?? '—'}.</p>` +
        (r.notifiable ? `<p style="margin:.5em 0;color:#9a2b2b"><b>WorkSafe WA must be notified immediately by phone.</b></p>` : '') +
        `<p style="margin:.5em 0"><a href="${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me'}/incidents/${r.id}">Open the report</a></p>` +
        `</div>`,
    }),
  });
  if (!send.ok) return fail('server_error', 'The email could not be sent.', 502);
  await createAdminClient().from('incidents').update({ notified_at: new Date().toISOString() }).eq('id', id);
  return ok({ sent: true, to: list.length });
}
