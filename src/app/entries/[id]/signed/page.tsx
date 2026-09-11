import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, canAuthorEntries } from '@/lib/auth';
import { PdfButton } from './pdf-button';
import { CorrectButton } from './correct-button';
import { EmailPdfButton } from './email-button';
import { fmtDate } from '@/lib/pdf/dates';
import { DayNav } from '@/components/day-nav';
import { loadDayNeighbours } from '@/lib/entries/neighbours';

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
  const { memberships, userId } = await requireUser();
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from('entries')
    .select(
      `id, entry_no, entry_date, status, signed_at, content_hash, supersedes_entry_id, author_id, signed_by, project_id,
       project:projects!inner(name, code, org:organisations!inner(name, code)),
       dayworks(id), variations(id)`,
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
  // Whoever signed is the signatory. A colleague may finish and sign a day
  // someone else started; the record shows both.
  const signerId = (entry.signed_by as string | null) ?? (entry.author_id as string);
  const { data: signer } = signerId === entry.author_id
    ? { data: author }
    : await supabase.from('profiles').select('full_name, email').eq('id', signerId).maybeSingle();

  const dayworkCount = ((entry.dayworks ?? []) as unknown[]).length;
  const variationCount = ((entry.variations ?? []) as unknown[]).length;
  const clientItems = dayworkCount + variationCount;
  const project = first(entry.project) as { name: string; code: string; org: unknown } | null;
  const org = first(project?.org) as { name: string; code: string } | null;
  const neighbours = await loadDayNeighbours(supabase, entry.project_id as string, entry.entry_date as string);

  if (entry.status !== 'signed') {
    // The author's own draft lives on the review screen. Anyone else on the
    // job — the supervisor checking what the leading hand has put in, the PM
    // looking at today — gets a read-only view of what has been entered so
    // far, marked as a working draft. Nothing here is on the record yet.
    if (
      entry.author_id === userId ||
      memberships.some((m) => m.project_id === (entry.project_id as string) && canAuthorEntries(m.role))
    ) redirect(`/entries/${id}/review`);
    const who = author?.full_name ?? author?.email ?? 'someone else';
    return (
      <main className="sheet">
        <p className="label">{org?.name}</p>
        <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.375rem', fontWeight: 600 }}>
          Draft for {fmtDate(entry.entry_date as string)}
        </h1>
        <p className="mono" style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)' }}>
          {project?.name} · started by {who}
        </p>
        <DayNav neighbours={neighbours} target="day" />
        <hr className="rule" />
        <p className="notice gap">
          Not signed yet. {who} is still working on this day; nothing in it is on the record
          until they sign it, and only they can change it.
        </p>
        <Link className="button" href={`/entries/${id}/docket`}>
          See what has been entered so far
        </Link>
        <Link className="button button--quiet" href="/">
          Home
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
        {project?.name} · {fmtDate(entry.entry_date as string)}
      </p>
      <DayNav neighbours={neighbours} target="day" />

      <hr className="rule" />

      <div className="grid-2">
        <div>
          <p className="label">Signed by</p>
          <p style={{ margin: '0.25rem 0 0' }}>{signer?.full_name ?? signer?.email ?? '—'}</p>
          {signerId !== entry.author_id && (
            <p className="caption" style={{ margin: '0.15rem 0 0' }}>Started by {author?.full_name ?? author?.email ?? '—'}</p>
          )}
        </div>
        <div>
          <p className="label">Signed at</p>
          <p className="mono" style={{ margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
            {entry.signed_at ? `${new Date(entry.signed_at).toLocaleString('en-AU', { timeZone: 'Australia/Perth' })} AWST` : '—'}
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
      <PdfButton entryId={id} entryNo={entry.entry_no as string | null} />
      <EmailPdfButton entryId={id} />

      <Link className="button button--quiet" href={`/entries/${id}/docket`}>
        View the docket on screen
      </Link>

      <hr className="rule" />
      <p className="label">For the client</p>
      {clientItems > 0 ? (
        <>
          <p style={{ margin: '0.25rem 0 0.75rem', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
            Just the {dayworkCount > 0 && variationCount > 0
              ? `${dayworkCount} daywork${dayworkCount === 1 ? '' : 's'} and ${variationCount} variation${variationCount === 1 ? '' : 's'}`
              : dayworkCount > 0
                ? `${dayworkCount} daywork${dayworkCount === 1 ? '' : 's'}`
                : `${variationCount} variation${variationCount === 1 ? '' : 's'}`} from this day, with
            the photos and a sign-off block for their representative. The rest of the diary stays
            with you.
          </p>
          <PdfButton
            entryId={id}
            entryNo={entry.entry_no as string | null}
            endpoint="client-sheet"
            label="Make the dayworks & variations sheet"
            shareTitle={`Dayworks and variations — ${fmtDate(entry.entry_date as string)}`}
          />
          <EmailPdfButton
            entryId={id}
            doc="dayworks"
            heading="Email the sheet to the client"
            placeholder="client@example.com — up to 5, comma-separated"
          />
        </>
      ) : (
        <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
          No dayworks or variations on this day, so there is nothing separate to send.
        </p>
      )}

      {memberships.some(
        (m) => m.project_id === (entry.project_id as string) && canAuthorEntries(m.role),
      ) && (
        <>
          <hr className="rule" />
          <p className="label">Something missing?</p>
          <CorrectButton entryId={id} />
        </>
      )}

      <Link className="button button--quiet" href="/">
        Home
      </Link>
    </main>
  );
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}
