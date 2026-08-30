import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { PdfButton } from './pdf-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signed · Site Diary' };

/**
 * Screen 4 (brief §7.4): confirmation, entry serial, content hash.
 *
 * The hash is shown in full and in monospace on purpose. It is the thing that
 * makes the entry checkable a year later — anyone holding the PDF can
 * recompute it against the stored record and see whether they match.
 */
export default async function SignedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from('entries')
    .select(
      `id, entry_no, entry_date, status, signed_at, content_hash, supersedes_entry_id, author_id,
       project:projects!inner(name, code, org:organisations!inner(name, code))`,
    )
    .eq('id', id)
    .maybeSingle();

  if (!entry) notFound();

  // Separate fetch kept for stability; since 20260902090200 an embedded join
  // via entries_author_profiles_fkey also works. (The original bug here: the
  // old auth.users FK hint made the whole query fail, as a 404.)
  const { data: author } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', entry.author_id)
    .maybeSingle();

  const project = first(entry.project) as { name: string; code: string; org: unknown } | null;
  const org = first(project?.org) as { name: string; code: string } | null;

  if (entry.status !== 'signed') {
    return (
      <main className="sheet">
        <p className="label">Site Diary</p>
        <hr className="rule" />
        <p className="notice gap">This entry has not been signed yet.</p>
        <Link className="button button--quiet" href={`/entries/${id}/review`}>
          Back to review
        </Link>
      </main>
    );
  }

  return (
    <main className="sheet">
      <span className="seal">Signed</span>
      <p className="label">{org?.name}</p>
      <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.375rem', fontWeight: 600 }}>Daily record</h1>

      <hr className="rule" />

      <p className="label">Entry</p>
      <p style={{ margin: '0.5rem 0 0' }}>
        <span className="stamp">{entry.entry_no}</span>
      </p>
      <p className="mono" style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)' }}>
        {project?.name} · {entry.entry_date}
      </p>

      <hr className="rule" />

      <div className="grid-2">
        <div>
          <p className="label">Signed by</p>
          <p style={{ margin: '0.25rem 0 0' }}>{author?.full_name ?? author?.email ?? '—'}</p>
        </div>
        <div>
          <p className="label">Signed at</p>
          <p className="mono" style={{ margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
            {entry.signed_at ? new Date(entry.signed_at).toLocaleString('en-AU') : '—'}
          </p>
        </div>
      </div>

      <hr className="rule" />

      <p className="label">Content hash · SHA-256</p>
      <p className="mono hash">{entry.content_hash}</p>
      <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
        This entry is now part of the record and cannot be edited. If something in it is wrong,
        record a correction — a new entry that refers back to this one.
      </p>

      {entry.supersedes_entry_id && (
        <p className="notice" style={{ marginTop: '1rem' }}>
          This entry supersedes an earlier one.
        </p>
      )}

      <hr className="rule" />

      <p className="label">Daily PDF</p>
      <p style={{ margin: '0.25rem 0 0.75rem', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
        Rendered from the stored fields. The same entry always produces the same document.
      </p>
      <PdfButton entryId={id} />

      <Link className="button button--quiet" href={`/entries/${id}/docket`}>
        View the docket on screen
      </Link>

      <Link className="button button--quiet" href="/">
        Back to today
      </Link>
    </main>
  );
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}
