import { redirect } from 'next/navigation';
import { requireUser, resolveProject } from '@/lib/auth';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New project · KBS Daily Diary' };

/** A new job for the org — admins only; the RPC enforces it again underneath. */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (current.role !== 'admin') redirect(`/?project=${current.project_id}`);

  return (
    <NewProjectForm
      orgId={current.project.org.id}
      orgName={current.project.org.name}
      orgCode={current.project.org.code}
    />
  );
}
