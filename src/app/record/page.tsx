import { redirect } from 'next/navigation';
import { requireUser, resolveProject, canAuthorEntries } from '@/lib/auth';
import { RecordScreen } from './record-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recording · Site Diary' };

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; date?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project, date } = await searchParams;
  const current = resolveProject(memberships, project);

  // A requested past date must look like a date; the client rejects future
  // ones against the device's own calendar, which the server cannot know.
  const forDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

  if (!current || !canAuthorEntries(current.role)) {
    redirect('/');
  }

  return (
    <RecordScreen
      projectId={current.project_id}
      projectName={current.project.name}
      orgCode={current.project.org.code}
      forDate={forDate}
    />
  );
}
