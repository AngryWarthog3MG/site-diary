import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isUuid } from '@/lib/api';
import { loadBookableNames, loadTraining } from '@/lib/training/load';
import { classWhenText } from '@/lib/training/courses';
import { ClassScreen } from './class-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training class · Kooboolong IMS' };

/** One class (README R188): its facts, who is booked, marking, the tickets tap, the sheet to print. */
export default async function ClassPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'training');
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const [data, names] = await Promise.all([loadTraining(supabase, org.id, { classId: id }), loadBookableNames(supabase, org.id)]);
  const cls = data.classes[0];
  const course = data.courses.find((c) => c.id === cls?.course_id);
  if (!cls || !course || cls.org_id !== org.id) notFound();
  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">{course.code} · {course.name}</h1>
      <p className="page-subtitle">{classWhenText(cls)}{cls.venue ? ` · ${cls.venue}` : ''}{cls.trainer_name ? ` · ${cls.trainer_name}` : ''}{cls.project_id ? ` · job ${data.projectCodes.get(cls.project_id) ?? ''}` : ' · the company'}</p>
      <ClassScreen
        projectId={current.project_id}
        today={today}
        cls={cls}
        course={course}
        attendees={data.attendees}
        ticketsByAttendee={[...data.ticketsByAttendee]}
        names={names}
        canManage={canAuthorEntries(current.role)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/training/classes${q}`}>Back to the classes</Link>
    </main>
  );
}
