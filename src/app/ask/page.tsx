import { redirect } from 'next/navigation';
import { requireUser, resolveProject } from '@/lib/auth';
import { AskScreen } from './ask-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask · Site Diary' };

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);

  if (!current) redirect('/');

  return <AskScreen projectId={current.project_id} projectName={current.project.name} />;
}
