import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { RegisterList, type RegisterRow } from './register-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entries · Site Diary' };

/**
 * The register: every entry on the project, newest first.
 *
 * This is where "where do I find the PDFs" is answered. Each signed entry
 * opens its signed page, which carries the docket view and the PDF button.
 * Ordered by entry_date rather than serial — serials follow signing order,
 * and the register should read as a calendar.
 *
 * Costs nothing to run: one database query, no AI anywhere near it.
 */
export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from('entries')
    .select('id, entry_no, entry_date, status, author_id, signed_at, supersedes_entry_id, author:profiles!entries_author_profiles_fkey(full_name, email)')
    .eq('project_id', current.project_id)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = entries ?? [];

  return (
    <main className="sheet">
      <p className="label">{current.project.name}</p>
      <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.375rem', fontWeight: 600 }}>Entries</h1>
      <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
        Signed entries carry the docket and its PDF. Drafts are still being worked on.
      </p>

      <hr className="rule" />

      <RegisterList
        projectId={current.project_id}
        rows={rows.map((entry): RegisterRow => {
          const author = (Array.isArray(entry.author) ? entry.author[0] : entry.author) as
            | { full_name: string | null; email: string | null }
            | null;
          return {
            id: entry.id,
            entry_no: entry.entry_no,
            entry_date: entry.entry_date,
            status: entry.status,
            mine: entry.author_id === userId,
            authorName: author?.full_name ?? author?.email ?? '—',
            correction: Boolean(entry.supersedes_entry_id),
          };
        })}
      />

      <hr className="rule" />
      <Link className="button button--quiet" href="/">
        Back to today
      </Link>
    </main>
  );
}
