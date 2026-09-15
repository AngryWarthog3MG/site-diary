import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { OutboxStatus } from '@/components/outbox-status';
import { KIND_LABEL, type SwmsKind } from '@/lib/swms/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SWMS & JSA · KBS Daily Diary' };

interface Row {
  id: string;
  kind: SwmsKind;
  title: string;
  version: number;
  status: 'draft' | 'active' | 'superseded' | 'archived';
  activated_at: string | null;
  updated_at: string;
  swms_signons: Array<{ id: string }>;
}

/** Every method statement on the job: in use first, then drafts, then the old ones. */
export default async function SwmsListPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }
  if (!sees(current, 'swms')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase
    .from('swms')
    .select('id, kind, title, version, status, activated_at, updated_at, swms_signons(id)')
    .eq('project_id', current.project_id)
    .order('title')
    .order('version', { ascending: false });
  const rows = (data ?? []) as Row[];
  const active = rows.filter((r) => r.status === 'active');
  const drafts = rows.filter((r) => r.status === 'draft');
  const old = rows.filter((r) => r.status === 'superseded' || r.status === 'archived');
  const canWrite = canAuthorEntries(current.role);
  const q = `?project=${current.project_id}`;

  const card = (r: Row) => (
    <Link key={r.id} href={`/swms/${r.id}`} className={`prestart-row ${r.status === 'active' ? 'prestart-row--done' : r.status === 'draft' ? 'prestart-row--open' : ''}`}>
      <span>
        <strong>{KIND_LABEL[r.kind]}</strong> · {r.title} · v{r.version}
        <br />
        <span className="caption">
          {r.status === 'active'
            ? `In use since ${fmtDate(r.activated_at)} · ${r.swms_signons.length} signed on`
            : r.status === 'draft'
              ? `Draft · last edited ${fmtDate(r.updated_at)}`
              : `${r.status === 'superseded' ? 'Superseded' : 'Archived'} · ${r.swms_signons.length} signed on`}
        </span>
      </span>
      <span>Open</span>
    </Link>
  );

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">SWMS &amp; JSA</h1>
      <p className="page-subtitle">
        The method statement for each high-risk task, and the job safety analysis for the rest.
        A draft is written and checked; put into use it is frozen and the crew sign on to it; a change
        is a new version.
      </p>
      {canWrite && (
        <div className="photo-add-pair">
          <Link className="button" href={`/swms/new${q}&kind=swms`}>New SWMS</Link>
          <Link className="button button--quiet" href={`/swms/new${q}&kind=jsa`}>New JSA</Link>
        </div>
      )}
      <OutboxStatus />
      <hr className="rule" />
      <p className="label">In use</p>
      {active.length === 0 ? <p className="nil">Nothing in use yet.</p> : active.map(card)}
      {drafts.length > 0 && (<><p className="label" style={{ marginTop: '1rem' }}>Drafts</p>{drafts.map(card)}</>)}
      {old.length > 0 && (<><p className="label" style={{ marginTop: '1rem' }}>Superseded and archived</p>{old.map(card)}</>)}
    </main>
  );
}
