import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { competencies } from '@/lib/training/model';
import { loadTraining } from '@/lib/training/load';
import { CoursesScreen } from './courses-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training courses · Kooboolong IMS' };

/** The company's course catalogue (README R188): what each course is, how long it runs and stays current, and the ticket it earns. */
export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'training');
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const org = current.project.org;
  const [data, { data: custom }] = await Promise.all([
    loadTraining(supabase, org.id),
    supabase.from('org_competencies').select('key, label, valid_months, active').eq('org_id', org.id).order('label'),
  ]);
  const comps = competencies((custom ?? []) as Array<{ key: string; label: string; valid_months: number | null; active: boolean }>);
  const classesPerCourse = new Map<string, number>();
  for (const c of data.classes) classesPerCourse.set(c.course_id, (classesPerCourse.get(c.course_id) ?? 0) + 1);
  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Training courses</h1>
      <p className="page-subtitle">The company&rsquo;s catalogue: each course with its unit of competency, how long it runs, how long it stays current, who provides it, and the ticket it earns. A class is a session of one of these.</p>
      <div className="photo-add-pair">
        <Link className="button button--quiet" href={`/training/classes${q}`}>Classes</Link>
        <Link className="button button--quiet" href={`/training${q}`}>Training matrix</Link>
      </div>
      <CoursesScreen orgId={org.id} courses={data.courses} competencies={comps.map((c) => ({ key: c.key, label: c.label }))} classesPerCourse={Object.fromEntries(classesPerCourse)} canManage={canAuthorEntries(current.role)} />
    </main>
  );
}
