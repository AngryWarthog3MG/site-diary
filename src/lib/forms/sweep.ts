import { createAdminClient } from '@/lib/supabase/admin';
import { sendPush, PushConfigError } from '@/lib/push/send';
import { siteUrl } from '@/lib/site-url';
import { fmtDate, perthDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { nextDue, remindDue, describeEvery, type Unit } from './schedule';

/**
 * The nightly form sweep (README R181), `?forms=1` on the ops check. For every active schedule whose next due is
 * within three days or gone by, and that was not told tonight already: a push to the person it is assigned to, and
 * — for the ones overdue on a job — one email per job to `projects.report_emails` listing them. The next due is read
 * off the last completed form, never stored; the only thing written is the server's `last_reminded_on`, so the
 * same schedule is told once a night however many times the sweep runs. Service role: the subscriptions and the
 * schedules are other people's.
 */

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Sched = { id: string; org_id: string; project_id: string | null; template_code: string; assigned_to: string | null; subject_plant_id: string | null; subject_person: string | null; every: number; unit: Unit; first_due_on: string; active: boolean; last_reminded_on: string | null };
type Proj = { id: string; org_id: string; name: string; code: string; active: boolean; report_emails: string[] | null };

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

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Kooboolong IMS <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`, to: [to], subject, html }),
  }).catch(() => null);
  return Boolean(res && res.ok);
}

export async function formScheduleSweep(today = perthToday()): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data: schedRows, error } = await admin.from('form_schedules').select('id, org_id, project_id, template_code, assigned_to, subject_plant_id, subject_person, every, unit, first_due_on, active, last_reminded_on').eq('active', true);
  if (error) return { error: error.message };
  const scheds = (schedRows ?? []) as Sched[];
  if (scheds.length === 0) return { due: 0, pushed: 0, emailed: 0 };
  const [{ data: done }, { data: tpls }, { data: projs }, { data: plant }] = await Promise.all([
    admin.from('form_submissions').select('schedule_id, completed_at, completed_on_device_at').in('schedule_id', scheds.map((s) => s.id)).eq('status', 'completed'),
    admin.from('form_templates').select('org_id, code, title').eq('status', 'issued'),
    admin.from('projects').select('id, org_id, name, code, active, report_emails'),
    admin.from('plant_register').select('id, name, plant_no').in('id', [...new Set(scheds.map((s) => s.subject_plant_id).filter((v): v is string => Boolean(v)))]),
  ]);
  const lastDone = new Map<string, string>();
  for (const d of (done ?? []) as Array<{ schedule_id: string; completed_at: string | null; completed_on_device_at: string | null }>) {
    const day = perthDate(d.completed_on_device_at ?? d.completed_at);
    const prev = lastDone.get(d.schedule_id);
    if (day && (!prev || day > prev)) lastDone.set(d.schedule_id, day);
  }
  const titleOf = new Map<string, string>();
  for (const t of (tpls ?? []) as Array<{ org_id: string; code: string; title: string }>) titleOf.set(`${t.org_id}:${t.code}`, t.title);
  const projOf = new Map<string, Proj>();
  for (const p of (projs ?? []) as Proj[]) projOf.set(p.id, p);
  const machineOf = new Map<string, string>();
  for (const p of (plant ?? []) as Array<{ id: string; name: string; plant_no: string | null }>) machineOf.set(p.id, p.plant_no ? `${p.name} · ${p.plant_no}` : p.name);

  let due = 0; let pushed = 0; let emailed = 0;
  const overdueByJob = new Map<string, string[]>();
  for (const s of scheds) {
    const proj = s.project_id ? projOf.get(s.project_id) : null;
    if (s.project_id && (!proj || !proj.active)) continue;
    const title = titleOf.get(`${s.org_id}:${s.template_code}`);
    if (!title) continue; // Nothing issued under that code: nothing can be filled, nothing to chase.
    const next = nextDue(s, lastDone.get(s.id) ?? null);
    if (!remindDue(next, today, s.last_reminded_on)) continue;
    due += 1;
    const about = s.subject_plant_id ? machineOf.get(s.subject_plant_id) ?? null : s.subject_person;
    const overdue = next != null && next < today;
    const line = `${about ? `${about} · ` : ''}${describeEvery(s.every, s.unit)} · ${overdue ? 'was due' : 'due'} ${fmtDate(next)}${proj ? ` · ${proj.code}` : ''}`;
    if (s.assigned_to) {
      pushed += await pushTo(s.assigned_to, `${overdue ? 'Form overdue' : 'Form due'}: ${title.length > 50 ? `${title.slice(0, 47)}…` : title}`, line, `/forms${s.project_id ? `?project=${s.project_id}` : ''}`, `form-sched-${s.id}`);
    }
    if (overdue && proj) overdueByJob.set(proj.id, [...(overdueByJob.get(proj.id) ?? []), `${esc(title)} — ${esc(line)}`]);
    await admin.from('form_schedules').update({ last_reminded_on: today }).eq('id', s.id);
  }
  for (const [projectId, lines] of overdueByJob) {
    const proj = projOf.get(projectId)!;
    for (const to of proj.report_emails ?? []) {
      const ok = await sendEmail(to, `Forms overdue — ${proj.code} ${proj.name}`,
        `<div style="font-family:Arial,sans-serif;max-width:560px"><p style="font-size:11px;letter-spacing:.08em;color:#9a2b2b;font-weight:bold;text-transform:uppercase">Forms overdue</p><h2 style="margin:.25em 0">${esc(proj.name)}</h2><ul>${lines.map((l) => `<li style="margin:.25em 0">${l}</li>`).join('')}</ul><p style="margin:.5em 0"><a href="${esc(siteUrl())}/forms/calendar?project=${esc(projectId)}">Open the forms calendar</a> · a scheduled form is next due an interval from when the last one was done.</p></div>`);
      if (ok) emailed += 1;
    }
  }
  return { due, pushed, emailed, jobsEmailed: overdueByJob.size };
}
