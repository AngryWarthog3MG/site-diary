import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import documents · Kooboolong IMS' };

/** Bring the company's existing PDFs in at once (README R120). Titles, codes and kinds are read off the file names and checked by a person before anything is saved. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'procedures');
  if (!canAuthorEntries(current.role)) redirect(`/procedures?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase.from('controlled_documents').select('id, title, doc_number').eq('org_id', current.project.org.id);
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Import documents</h1>
      <p className="page-subtitle">
        Drop in the PDFs you already have — up to 40 at a time, 25 MB each. The title, code and kind are read off each file name
        (<span className="mono">POL-002 Code of Conduct v4.pdf</span> becomes POL-002, Code of Conduct, a policy). Check the table, then bring
        them in as drafts to issue one by one, or issue them all now.
      </p>
      <ImportForm orgId={current.project.org.id} projectId={current.project_id} userId={userId} existing={(data ?? []).map((d) => ({ id: d.id as string, title: d.title as string, doc_number: (d.doc_number as string | null) ?? null }))} />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/procedures?project=${current.project_id}`}>Back to Policies &amp; procedures</Link>
    </main>
  );
}
