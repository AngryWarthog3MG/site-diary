import { redirect } from 'next/navigation';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { NewPrestartForm } from './new-prestart-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New prestart · KBS Daily Diary' };

export default async function NewPrestartPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships, profile } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canRunTalks(current.role)) redirect(`/prestart?project=${current.project_id}`);

  return (
    <NewPrestartForm
      projectId={current.project_id}
      projectName={current.project.name}
      defaultSupervisor={profile?.full_name ?? ''}
    />
  );
}
