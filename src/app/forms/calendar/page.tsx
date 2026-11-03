import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canManageRegisters } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { loadSchedules, loadTemplates } from '@/lib/forms/load';
import { loadPlantOnJob } from '@/lib/plant/on-job';
import { peopleOnJob } from '@/lib/crew/inductions';
import { monthLabel, nextMonth, prevMonth, readMonth, monthStart, monthEnd } from '@/lib/deliveries/model';
import { FormsCalendar, type DoneOnDay } from './forms-calendar';
import { loadJobPeople } from '@/lib/members/people';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forms calendar · Kooboolong IMS' };

/**
 * The forms calendar (README R181): every scheduled form on this job — its own and the company-wide ones — on the
 * day it is next due and each interval after, the forms completed in the month on the day they were done, and the
 * schedules themselves: set here by whoever runs the job, retired here, never deleted. A labourer's due forms sit on
 * their Forms screen; this page is not one of their doors.
 */
export default async function FormsCalendarPage({ searchParams }: { searchParams: Promise<{ project?: string; month?: string }> }) {
  const { userId, memberships } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);
  if (!current) redirect('/');
  guardScreen(current, 'forms');
  const q = `?project=${current.project_id}`;
  if (current.role === 'labourer') redirect(`/forms${q}`);
  const today = perthToday();
  const month = readMonth(params.month, today);
  const supabase = await createClient();
  const orgId = current.project.org.id;
  const [schedules, templates, { data: doneRows }, machines, { data: crew }, memberRows] = await Promise.all([
    loadSchedules(supabase, orgId, current.project_id, today),
    loadTemplates(supabase, orgId),
    supabase.from('form_submissions').select('id, template_code, template_title, subject_person, subject_plant_id, completed_at, completed_on_device_at, outcome, schedule_id')
      .eq('project_id', current.project_id).eq('status', 'completed')
      .gte('completed_at', `${monthStart(month)}T00:00:00+08:00`).lte('completed_at', `${monthEnd(month)}T23:59:59+08:00`),
    loadPlantOnJob(supabase, current.project_id),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true),
    loadJobPeople(supabase, current.project_id, { everyone: true }),
  ]);
  const people = peopleOnJob(memberRows.map((m) => m.name), ((crew ?? []) as Array<{ name: string }>).map((c) => c.name));
  const done: DoneOnDay[] = ((doneRows ?? []) as Array<{ id: string; template_code: string; template_title: string; subject_person: string | null; completed_at: string; completed_on_device_at: string | null; outcome: string | null; schedule_id: string | null }>)
    .map((d) => ({ id: d.id, code: d.template_code, title: d.template_title, about: d.subject_person, at: d.completed_on_device_at ?? d.completed_at, outcome: d.outcome, scheduleId: d.schedule_id }));
  const office = current.role === 'pm' || current.role === 'admin';
  const at = (m: string) => `/forms/calendar?project=${current.project_id}&month=${m}`;

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <OutboxStatus />
      <h1 className="page-title">Forms calendar</h1>
      <p className="page-subtitle">
        Scheduled forms on the day they fall due, and the forms done this month on the day they were done. The next one is due
        an interval from when the last was done — a weekly inspection done late is next due a week from the doing.
      </p>
      <nav className="chips" aria-label="Month" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.75rem', alignItems: 'center' }}>
        <Link href={at(prevMonth(month))} className="chip chip--link">‹ {monthLabel(prevMonth(month))}</Link>
        <span className="chip chip--on" aria-current="page">{monthLabel(month)}</span>
        <Link href={at(nextMonth(month))} className="chip chip--link">{monthLabel(nextMonth(month))} ›</Link>
        {month !== today.slice(0, 7) && <Link href={at(today.slice(0, 7))} className="chip chip--link">This month</Link>}
      </nav>
      <FormsCalendar
        orgId={orgId}
        projectId={current.project_id}
        userId={userId}
        month={month}
        today={today}
        schedules={schedules.map((s) => ({ ...s }))}
        done={done}
        templates={templates.filter((t) => t.status === 'issued').map((t) => ({ id: t.id, code: t.code, title: t.title, subject: t.subject }))}
        machines={machines.map((m) => ({ id: m.id, name: m.plant_no ? `${m.name} · ${m.plant_no}` : m.name }))}
        people={people}
        members={memberRows}
        canSet={canManageRegisters(current.role)}
        canSetCompany={office}
      />
      <p className="caption" style={{ marginTop: '1rem' }}><Link href={`/forms${q}`}>Back to forms</Link></p>
    </main>
  );
}
