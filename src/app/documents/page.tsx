import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { DocumentsManager, type DocumentRow } from './documents-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job documents · KBS Daily Diary' };

/**
 * The job's papers: specification, scope, contract, drawings register, safety
 * plan. Upload them once and Ask answers from them with the clause cited.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_documents')
    .select('id, title, kind, revision, filename, mime_type, bytes, pages, chars, status, error, method, created_at, indexed_at')
    .eq('project_id', current.project_id)
    .order('created_at', { ascending: false });

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">Job documents</h1>
      <p className="page-subtitle">
        The spec, scope, contract, drawings register and safety plan. Upload them here once and
        Ask can answer from them — &ldquo;what depth is the topsoil at the bus port&rdquo; comes back
        with the clause and page. They are reference only; nothing here goes into a diary.
      </p>
      <hr className="rule" />
      <DocumentsManager projectId={current.project_id} userId={userId} initial={(data ?? []) as DocumentRow[]} />
    </main>
  );
}
