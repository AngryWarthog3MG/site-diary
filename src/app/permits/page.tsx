import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { fmtDate, fmtPerthDate, perthDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { KIND_LABEL, STATUS_LABEL, permitRef, expired, live, type PermitKind, type PermitStatus } from '@/lib/permits/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Permits to work · KBS Daily Diary' };

interface Row { id: string; seq: number; kind: PermitKind; title: string; location: string | null; valid_from: string; valid_to: string; status: PermitStatus; holder_name: string }

export default async function PermitsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'permits')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase.from('permits').select('id, seq, kind, title, location, valid_from, valid_to, status, holder_name')
    .eq('project_id', current.project_id).order('valid_from', { ascending: false }).limit(200);
  const rows = (data ?? []) as Row[];
  const nowIso = new Date().toISOString();
  const current_ = rows.filter((r) => r.status === 'issued' || r.status === 'open').sort((a, b) => a.valid_to.localeCompare(b.valid_to));
  const past = rows.filter((r) => r.status === 'closed' || r.status === 'cancelled');
  const q = `?project=${current.project_id}`;
  const card = (r: Row) => {
    const isLive = live(r, nowIso); const isExpired = expired(r, nowIso);
    return (
      <Link key={r.id} href={`/permits/${r.id}`} className={`prestart-row ${isExpired || r.status === 'open' ? 'prestart-row--open' : isLive ? 'prestart-row--done' : ''}`}>
        <span>
          <strong>{permitRef(r.seq)}</strong> · {KIND_LABEL[r.kind]} · {r.title}
          <br />
          <span className="caption">{fmtPerthDate(r.valid_from)} {awstClock(r.valid_from)}–{awstClock(r.valid_to)}{perthDate(r.valid_to) !== perthDate(r.valid_from) ? ` ${fmtPerthDate(r.valid_to)}` : ''}{r.location ? ` · ${r.location}` : ''} · holder {r.holder_name}</span>
          <br />
          <span className="caption">{isExpired ? 'PAST ITS WINDOW — not closed' : isLive ? 'Live now' : STATUS_LABEL[r.status]}</span>
        </span>
        <span>Open</span>
      </Link>
    );
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Permits to work</h1>
      <p className="page-subtitle">Written permission for one high-risk task, in one place, for one window: controls walked and signed by the issuer and the holder, then closed out when the area is left safe.</p>
      {canAuthorEntries(current.role) && <Link className="button" href={`/permits/new${q}`}>Raise a permit</Link>}
      <OutboxStatus />
      <hr className="rule" />
      <p className="label">Current</p>
      {current_.length === 0 ? <p className="nil">No permits open.</p> : current_.map(card)}
      {past.length > 0 && (<><p className="label" style={{ marginTop: '1rem' }}>Closed and cancelled</p>{past.map(card)}</>)}
    </main>
  );
}
