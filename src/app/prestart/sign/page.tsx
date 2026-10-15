import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { normaliseName } from '@/lib/crew/tickets';
import { readChecklist } from '@/lib/prestart/checklist';
import { PrestartSignScreen, type SignablePrestart } from './sign-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign on to the prestart · Kooboolong IMS' };

/**
 * Today's open prestart on each job you are on, and whether you have signed on
 * to it — the worker's own door (README R141). Reads are the database's rule:
 * an open prestart is every member's, your own sign-on is yours; a finished
 * one keeps the record lock, so it is not here.
 */
export default async function PrestartSignPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, profile, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'prestart_sign');
  const myName = (profile?.full_name ?? '').replace(/\s+/g, ' ').trim();
  const today = perthToday();
  const jobs = memberships.filter((m) => m.project.active).map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name }));
  const supabase = await createClient();
  const { data: rows } = jobs.length
    ? await supabase
        .from('prestarts')
        .select('id, project_id, prestart_date, supervisor_name, work_planned, hazards, plant, permits, notes, checklist, prestart_attendees(attendee_name, created_at)')
        .in('project_id', jobs.map((j) => j.id))
        .eq('prestart_date', today)
        .is('completed_at', null)
        .order('created_at')
    : { data: [] };
  const list: SignablePrestart[] = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => {
    const job = jobs.find((j) => j.id === r.project_id);
    const mine = ((r.prestart_attendees as Array<{ attendee_name: string; created_at: string }> | null) ?? []).find((a) => normaliseName(a.attendee_name) === normaliseName(myName));
    return {
      id: String(r.id), projectId: String(r.project_id), jobName: job?.name ?? 'Job', jobCode: job?.code ?? '',
      date: String(r.prestart_date), supervisor: String(r.supervisor_name), work: String(r.work_planned), hazards: String(r.hazards),
      plant: (r.plant as string | null) ?? '', permits: (r.permits as string | null) ?? '', notes: (r.notes as string | null) ?? '',
      checklist: readChecklist(r.checklist), signedOnAt: mine?.created_at ?? null,
    };
  });

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Sign on to the prestart</h1>
      <p className="page-subtitle">
        Today’s briefing on your job. Read it — what is on, what could hurt someone — then sign on as yourself from your own phone. Once per prestart.
      </p>
      <OutboxStatus />
      <PrestartSignScreen userId={userId} myName={myName} list={list} />
    </main>
  );
}
