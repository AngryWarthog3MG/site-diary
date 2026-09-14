import { redirect } from 'next/navigation';
import { requireUser, resolveProject } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { IssueForm } from './issue-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Issue a document · KBS Daily Diary' };

export default async function NewProcedurePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/procedures?project=${current.project_id}`);
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Issue a document</h1>
      <IssueForm orgId={current.project.org.id} projectId={current.project_id} userId={userId} />
    </main>
  );
}
