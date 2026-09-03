import { redirect } from 'next/navigation';
import { requireUser, resolveProject, canAuthorEntries } from '@/lib/auth';
import { NewTalkForm } from './new-talk-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New toolbox talk · KBS Daily Diary' };

export default async function NewTalkPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/toolbox?project=${current.project_id}`);

  return <NewTalkForm projectId={current.project_id} projectName={current.project.name} />;
}
