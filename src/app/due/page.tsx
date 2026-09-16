import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { loadObligations } from '@/lib/obligations/load';
import { STATUS_LABEL, type ObligationItem } from '@/lib/obligations/model';
import { AddSchedule } from './add-schedule';

export const dynamic = 'force-dynamic';
export const metadata = { title: "What's due · KBS Daily Diary" };

const SOURCE_LABEL: Record<ObligationItem['source'], string> = {
  scheduled: 'Schedule',
  sds: 'Chemicals',
  ticket: 'Tickets',
  incident: 'WorkSafe',
  emergency: 'Emergency plan',
  plant: 'Plant',
  construction: 'Construction',
};

/**
 * Everything that falls due on this job, in the order it needs doing: audits,
 * reviews and drills on their schedules, safety data sheets coming up for
 * review, tickets about to lapse. The question a surveillance auditor asks of
 * every module, answered in one place: here is the schedule, and here is the
 * evidence each one happened on time.
 */
export default async function DuePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'obligations')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const today = perthToday();
  const data = await loadObligations(supabase, current.project_id, current.project.org.id, today);
  const q = `?project=${current.project_id}`;
  const groups: Array<{ label: string; items: ObligationItem[] }> = [
    { label: 'Overdue', items: data.items.filter((i) => i.status === 'overdue') },
    { label: 'Due in the next 30 days', items: data.items.filter((i) => i.status === 'due_soon') },
    { label: 'Later', items: data.items.filter((i) => i.status === 'upcoming') },
  ];

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">What&rsquo;s due</h1>
      <p className="page-subtitle">
        Audits, reviews, drills, safety data sheets and tickets, in the order they need doing. Each schedule
        keeps the day every occurrence was done, so it shows whether it happened on time.
      </p>

      <div className="chemreg__stats">
        <span className={data.summary.overdue > 0 ? 'vr-missing' : undefined}><strong className="mono">{data.summary.overdue}</strong> overdue</span>
        <span><strong className="mono">{data.summary.dueSoon}</strong> due in 30 days</span>
        <span><strong className="mono">{data.summary.upcoming}</strong> later</span>
      </div>

      {data.items.length === 0 ? (
        <p className="nil" style={{ marginTop: '1rem' }}>
          Nothing scheduled and nothing coming due. Start with the internal audit and the emergency drill below —
          they are the two a certification auditor asks for first.
        </p>
      ) : (
        groups.filter((g) => g.items.length > 0).map((g) => (
          <section key={g.label} style={{ marginTop: '1.1rem' }}>
            <p className="label">{g.label}</p>
            <div className="chemreg__list">
              {g.items.map((item) => {
                const row = (
                  <>
                    <span>
                      <strong>{item.title}</strong>
                      <br />
                      <span className={`caption${item.status === 'overdue' ? ' vr-missing' : ''}`}>
                        {STATUS_LABEL[item.status]}{item.dueOn ? ` · ${item.status === 'overdue' ? 'was due' : 'due'} ${fmtDate(item.dueOn)}` : ''}
                        {' · '}{SOURCE_LABEL[item.source]}
                        {item.lateCount ? ` · ${item.lateCount} of ${item.completed} done late` : ''}
                      </span>
                      {item.basis && <><br /><span className="caption">{item.basis}</span></>}
                    </span>
                    <span className="chemreg__open">Open</span>
                  </>
                );
                const cls = `prestart-row ${item.status === 'overdue' ? 'prestart-row--open' : item.status === 'due_soon' ? '' : 'prestart-row--done'}`;
                return item.href
                  ? <Link key={item.key} href={item.href} className={cls}>{row}</Link>
                  : <div key={item.key} className={cls}>{row}</div>;
              })}
            </div>
          </section>
        ))
      )}

      {canAuthorEntries(current.role) && (
        <AddSchedule orgId={current.project.org.id} projectId={current.project_id} userId={userId} today={today} isAdmin={current.role === 'admin'} />
      )}

      <hr className="rule" />
      <p className="caption">
        Tickets appear here once they are within 30 days of expiring. Safety data sheets appear for every chemical on
        this site. Schedules without a job — the company&rsquo;s own management review, say — show on every job.
      </p>
      <Link className="button button--quiet" href={`/safety${q}`}>Safety dashboard</Link>
    </main>
  );
}
