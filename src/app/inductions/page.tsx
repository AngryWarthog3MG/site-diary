import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { Fold } from '@/components/fold';
import { perthToday } from '@/lib/push/decide';
import { peopleOnJob, notInducted, type Induction } from '@/lib/crew/inductions';
import { InductionsBlock } from '@/app/settings/members/inductions-block';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inductions · Kooboolong IMS' };

/**
 * Inductions on every job, side by side (README R138): for each active job the company has, who is inducted, when
 * and by whom, and who on the job is not. The same block a job's Settings shows, drawn once per job, so recording
 * one here is the same row the prestart and the gate read. Office — admin and PM.
 */
export default async function InductionsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'inductions');
  const org = current.project.org;
  const jobs = memberships
    .filter((m) => m.project.org.id === org.id && m.project.active)
    .map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name, canRecord: canRunTalks(m.role) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const ids = jobs.map((j) => j.id);
  const supabase = await createClient();
  const today = perthToday();
  const [{ data: crew }, { data: members }, { data: rows }] = await Promise.all([
    ids.length ? supabase.from('crew').select('project_id, name').in('project_id', ids).eq('active', true) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('project_members').select('project_id, user_id').in('project_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('crew_inductions').select('project_id, person_name, inducted_on, notes, inducted_by').in('project_id', ids).order('inducted_on', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  type C = { project_id: string; name: string };
  type M = { project_id: string; user_id: string };
  type R = { project_id: string; person_name: string; inducted_on: string; notes: string | null; inducted_by: string | null };
  const userIds = [...new Set([...((members ?? []) as M[]).map((m) => m.user_id), ...((rows ?? []) as R[]).map((r) => r.inducted_by).filter((v): v is string => Boolean(v))])];
  const { data: profiles } = userIds.length ? await supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] };
  const nameOf = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name]));

  const perJob = jobs.map((job) => {
    const people = peopleOnJob(
      ((members ?? []) as M[]).filter((m) => m.project_id === job.id).map((m) => nameOf.get(m.user_id) ?? null),
      ((crew ?? []) as C[]).filter((c) => c.project_id === job.id).map((c) => c.name),
    );
    const inductions: Induction[] = ((rows ?? []) as R[]).filter((r) => r.project_id === job.id).map((r) => ({
      person_name: r.person_name, inducted_on: r.inducted_on, notes: r.notes, recorded_by: r.inducted_by ? (nameOf.get(r.inducted_by) ?? null) : null,
    }));
    return { job, people, inductions, waiting: notInducted(people, inductions) };
  });
  const totals = {
    people: perJob.reduce((n, j) => n + j.people.length, 0),
    inducted: perJob.reduce((n, j) => n + j.inductions.length, 0),
    waiting: perJob.reduce((n, j) => n + j.waiting.length, 0),
  };
  const q = `?project=${current.project_id}`;

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Inductions</h1>
      <p className="page-subtitle">
        Who has had the site induction on each job, and who has not. An induction is per job and by name — the
        crew prestart and the gate mark a sign-on from anyone not on a job’s list. Record one here or on the day.
      </p>
      <div className="regs__facts docs__tiles">
        <span className="regs__fact"><span className="regs__fact-label">Jobs</span><span className="regs__fact-text docs__big">{jobs.length}</span><span className="regs__fact-sub">{totals.people} people across them</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Inducted</span><span className="regs__fact-text docs__big">{totals.inducted}</span><span className="regs__fact-sub">inductions recorded</span></span>
        <span className={`regs__fact${totals.waiting ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Not inducted</span><span className="regs__fact-text docs__big">{totals.waiting}</span><span className="regs__fact-sub">on a job with none recorded · <Link href={`/staff${q}`}>All staff</Link></span></span>
      </div>
      {perJob.length === 0 && <p className="nil">You are on no active job in {org.name}.</p>}
      {perJob.map(({ job, people, inductions, waiting }) => (
        <section key={job.id} className="indjob" aria-label={`${job.code} ${job.name}`}>
          <header className="indjob__head">
            <h2 className="indjob__name">{job.name} <span className="mono indjob__code">{org.code}_{job.code}</span></h2>
            <p className="caption indjob__meta">
              {inductions.length} inducted
              {waiting.length ? <> · <b className="indjob__bad">{waiting.length} not inducted</b></> : people.length ? ' · everyone on the job' : ''}
              {' · '}<Link href={`/settings/members?project=${job.id}`}>Members</Link>
            </p>
          </header>
          <Fold label="Inductions" count={inductions.length + waiting.length} phoneOnly>
            <InductionsBlock projectId={job.id} userId={userId} people={people} inductions={inductions} canRecord={job.canRecord} today={today} />
          </Fold>
        </section>
      ))}
    </main>
  );
}
