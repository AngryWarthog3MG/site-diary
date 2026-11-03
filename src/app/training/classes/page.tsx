import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadTraining } from '@/lib/training/load';
import { summariseClasses } from '@/lib/training/courses';
import { ClassesScreen } from './classes-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training classes · Kooboolong IMS' };

/** The company's classes (README R188): what is coming up, what has run and is not yet marked, what was held. */
export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'training');
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const data = await loadTraining(supabase, org.id);
  const summary = summariseClasses(data.classes, data.attendees, today);
  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Training classes</h1>
      <p className="page-subtitle">Each class is a session of a course on a day: a trainer, a venue, seats. Book people on, then mark who came, the hours and the result. A ticket is recorded from the class by a tap, never by the class itself.</p>
      <div className="photo-add-pair">
        <Link className="button button--quiet" href={`/training/courses${q}`}>Courses</Link>
        <Link className="button button--quiet" href={`/training/report${q}`}>Training report</Link>
        <Link className="button button--quiet" href={`/training${q}`}>Training matrix</Link>
      </div>
      <section className="entries-summary" aria-label="Summary" style={{ marginTop: '1rem' }}>
        <div><p className="label">Upcoming</p><p className="entries-summary__value mono">{summary.upcoming + summary.today}</p></div>
        <div><p className="label">Booked</p><p className="entries-summary__value mono">{summary.booked}</p></div>
        <div><p className="label">Run, not marked</p><p className={`entries-summary__value mono${summary.needsMarking > 0 ? ' vr-missing' : ''}`}>{summary.needsMarking}</p></div>
        <div><p className="label">Held this year</p><p className="entries-summary__value mono">{summary.heldThisYear}</p></div>
      </section>
      <ClassesScreen orgId={org.id} projectId={current.project_id} jobCode={current.project.code} today={today} data={{ ...data, ticketsByAttendee: [...data.ticketsByAttendee], projectCodes: Object.fromEntries(data.projectCodes) }} canManage={canAuthorEntries(current.role)} />
    </main>
  );
}
