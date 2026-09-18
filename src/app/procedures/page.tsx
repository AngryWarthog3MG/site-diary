import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { KIND_LABEL, coverage, type ControlledKind } from '@/lib/documents-control/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Policies & procedures · Kooboolong IMS' };

interface Row {
  id: string; title: string; kind: ControlledKind; doc_number: string | null; requires_acknowledgement: boolean; active: boolean;
  document_versions: Array<{ id: string; version: number; status: string; issued_at: string; document_acknowledgements: Array<{ person_name: string }> }>;
}

export default async function ProceduresPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'procedures')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const [{ data }, { data: crew }] = await Promise.all([
    supabase.from('controlled_documents').select('id, title, kind, doc_number, requires_acknowledgement, active, document_versions(id, version, status, issued_at, document_acknowledgements(person_name))').eq('org_id', current.project.org.id).eq('active', true).order('title'),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true),
  ]);
  const rows = (data ?? []) as Row[];
  const crewNames = (crew ?? []).map((c) => String(c.name));
  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Policies &amp; procedures</h1>
      <p className="page-subtitle">The company&rsquo;s documents, one file per version. A new version supersedes the last and everyone reads again; the crew acknowledge on the phone with a signature.</p>
      {canAuthorEntries(current.role) && <Link className="button" href={`/procedures/new${q}`}>Issue a document</Link>}
      <OutboxStatus />
      <hr className="rule" />
      {rows.length === 0 ? <p className="nil">No documents issued yet.</p> : rows.map((r) => {
        const cur = r.document_versions.find((v) => v.status === 'current');
        const cov = cur ? coverage(crewNames, cur.document_acknowledgements.map((a) => a.person_name)) : { read: [], unread: crewNames };
        return (
          <Link key={r.id} href={`/procedures/${r.id}${q}`} className={`prestart-row ${!cur ? 'prestart-row--open' : r.requires_acknowledgement && cov.unread.length > 0 ? '' : 'prestart-row--done'}`}>
            <span>
              <strong>{r.title}</strong>{r.doc_number ? ` · ${r.doc_number}` : ''}
              <br />
              <span className="caption">{KIND_LABEL[r.kind]}{cur ? ` · v${cur.version} issued ${fmtPerthDate(cur.issued_at)}` : ' · no version issued'}{cur && r.requires_acknowledgement ? ` · ${cov.read.length} of ${crewNames.length} on this job have read it` : ''}</span>
            </span>
            <span>Open</span>
          </Link>
        );
      })}
    </main>
  );
}
