import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { canAuthorEntries, requireUser, resolveProject } from '@/lib/auth';
import { VocabularyForm, type KeywordRow } from './vocabulary-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vocabulary · Site Diary' };

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');

  const supabase = await createClient();
  const { data: keywords, error } = await supabase
    .from('project_keywords')
    .select('id, term, category, created_at')
    .eq('project_id', current.project_id)
    .order('category')
    .order('term');

  if (error) {
    throw new Error(`Could not load vocabulary: ${error.message}`);
  }

  const rows: KeywordRow[] = (keywords ?? []).map((keyword) => ({
    id: keyword.id as string,
    term: keyword.term as string,
    category: keyword.category as KeywordRow['category'],
  }));

  return (
    <main className="app-shell app-shell--narrow">
      <section className="sheet">
        <header className="page-header">
          <div>
            <p className="label">{current.project.name}</p>
            <h1 className="page-title">Vocabulary</h1>
            <p className="page-subtitle">
              Site names, suppliers, plant and area shorthand used by transcription and extraction.
            </p>
          </div>
        </header>

        <hr className="rule" />

        <VocabularyForm
          projectId={current.project_id}
          canEdit={canAuthorEntries(current.role)}
          keywords={rows}
        />

        <hr className="rule" />
        <Link className="button button--quiet" href={`/settings?project=${current.project_id}`}>
          Back to settings
        </Link>
      </section>
    </main>
  );
}
