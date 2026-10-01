import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { DUE_LABEL, KIND_LABEL, audienceText, type ControlledKind } from '@/lib/documents-control/model';
import { loadDocumentsOverview } from '@/lib/documents-control/load';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Policies & procedures · Kooboolong IMS' };

/**
 * The company's documents (README R120): what is waiting on you first, then
 * the library. A manager sees who has signed each one and the doors to issue,
 * import and the compliance overview.
 */
export default async function ProceduresPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'procedures');
  const supabase = await createClient();
  const today = perthToday();
  const rows = await loadDocumentsOverview(supabase, current.project.org.id, userId, today);
  const canManage = canAuthorEntries(current.role);
  const q = `?project=${current.project_id}`;
  const waiting = rows.filter((r) => r.mine && r.mine.status === 'pending');
  const library = rows.filter((r) => r.active);
  const retired = rows.filter((r) => !r.active);
  const chip = (state: string) => (state === 'overdue' ? 'status-pill status-pill--danger' : state === 'due_soon' ? 'status-pill status-pill--gap' : state === 'signed' ? 'status-pill status-pill--ready' : 'status-pill');

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Policies &amp; procedures</h1>
      <p className="page-subtitle">
        The company&rsquo;s documents, one file per version. A new version supersedes the last and everyone it binds reads it again and
        signs on their own phone that they have understood it.
      </p>
      {canManage && (
        <div className="docs__tools">
          <Link className="button" href={`/procedures/new${q}`}>Issue a document</Link>
          <Link className="button button--quiet" href={`/procedures/import${q}`}>Import PDFs</Link>
          <Link className="button button--quiet" href={`/procedures/compliance${q}`}>Compliance overview</Link>
        </div>
      )}
      <OutboxStatus />

      <hr className="rule" />
      <p className="label">Waiting on you · {waiting.length}</p>
      {waiting.length === 0 ? (
        <p className="caption">Nothing. Everything assigned to you is signed.</p>
      ) : (
        <ul className="register-list">
          {waiting.map((r) => (
            <li key={r.id}>
              <Link className="register-card" href={`/procedures/${r.id}${q}`}>
                <div className="register-card__main">
                  <p className="register-card__title">{r.title}</p>
                  <p className="register-card__meta">v{r.current?.version} · read and sign by {fmtDate(r.mine!.due_on)}</p>
                </div>
                <span className={chip(r.mine!.state)}>{DUE_LABEL[r.mine!.state]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <hr className="rule" />
      <p className="label">The library · {library.length}</p>
      {library.length === 0 ? <p className="nil">No documents issued yet.</p> : library.map((r) => (
        <Link key={r.id} href={`/procedures/${r.id}${q}`} className={`prestart-row ${!r.current ? 'prestart-row--open' : r.summary.pending > 0 ? '' : 'prestart-row--done'}`}>
          <span>
            <strong>{r.title}</strong>{r.doc_number ? ` · ${r.doc_number}` : ''}
            <br />
            <span className="caption">
              {KIND_LABEL[r.kind as ControlledKind] ?? r.kind}
              {r.current ? ` · v${r.current.version} issued ${r.current.issued_at ? fmtPerthDate(r.current.issued_at) : ''}` : ' · no version issued'}
              {r.draft ? ` · draft v${r.draft.version} waiting` : ''}
              {canManage && r.current && r.requires_acknowledgement ? ` · signed ${r.summary.signed} of ${r.summary.due}${r.summary.overdue ? ` · ${r.summary.overdue} overdue` : ''}` : ''}
              {canManage ? ` · ${audienceText(r.audience)}` : ''}
            </span>
          </span>
          <span>{r.mine ? DUE_LABEL[r.mine.state] : 'Open'}</span>
        </Link>
      ))}
      {retired.length > 0 && (
        <>
          <p className="label" style={{ marginTop: '1rem' }}>Archived · {retired.length}</p>
          {retired.map((r) => <Link key={r.id} href={`/procedures/${r.id}${q}`} className="prestart-row prestart-row--done"><span><strong>{r.title}</strong><br /><span className="caption">{KIND_LABEL[r.kind as ControlledKind] ?? r.kind} · archived</span></span><span>Open</span></Link>)}
        </>
      )}
    </main>
  );
}
