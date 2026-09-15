import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canReport } from '@/lib/auth';
import { canSee } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { KIND_LABEL, STATUS_LABEL, incidentRef, summarise, actionOverdue, type IncidentKind, type IncidentStatus } from '@/lib/incidents/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hazards & incidents · KBS Daily Diary' };

interface Row {
  id: string; seq: number; kind: IncidentKind; status: IncidentStatus; notifiable: boolean; occurred_at: string;
  location: string | null; description: string; injured_name: string | null;
  incident_actions: Array<{ due_on: string | null; done_at: string | null }>;
}

/** The register: open first, the oldest open at the top, closed below. */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  }
  if (!canSee(current.role, 'incidents')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase
    .from('incidents')
    .select('id, seq, kind, status, notifiable, occurred_at, location, description, injured_name, incident_actions(due_on, done_at)')
    .eq('project_id', current.project_id)
    .order('occurred_at', { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];
  const today = perthToday();
  const open = rows.filter((r) => r.status !== 'closed').sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const closed = rows.filter((r) => r.status === 'closed');
  const s = summarise(rows);
  const overdue = rows.reduce((n, r) => n + r.incident_actions.filter((a) => actionOverdue(a, today)).length, 0);
  const q = `?project=${current.project_id}`;

  const card = (r: Row) => {
    const openActions = r.incident_actions.filter((a) => a.done_at == null).length;
    const late = r.incident_actions.filter((a) => actionOverdue(a, today)).length;
    return (
      <Link key={r.id} href={`/incidents/${r.id}`} className={`prestart-row ${r.status === 'closed' ? 'prestart-row--done' : late > 0 || r.notifiable ? 'prestart-row--open' : ''}`}>
        <span>
          <strong>{incidentRef(r.seq)}</strong> · {KIND_LABEL[r.kind]}{r.notifiable ? ' · NOTIFIABLE' : ''}
          <br />
          <span className="caption">
            {fmtDate(r.occurred_at.slice(0, 10))}{r.location ? ` · ${r.location}` : ''} · {r.description.slice(0, 80)}{r.description.length > 80 ? '…' : ''}
          </span>
          <br />
          <span className="caption">{STATUS_LABEL[r.status]}{openActions > 0 ? ` · ${openActions} action${openActions === 1 ? '' : 's'} open` : ''}{late > 0 ? ` · ${late} overdue` : ''}</span>
        </span>
        <span>Open</span>
      </Link>
    );
  };

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Hazards &amp; incidents</h1>
      <p className="page-subtitle">
        Report it in a minute, on the phone, with photos. The report is frozen as the first account; what is
        learned goes on as updates, and corrective actions stay open until they are done.
      </p>
      {canReport(current.role) && <Link className="button" href={`/incidents/new${q}`}>Report a hazard or incident</Link>}
      <OutboxStatus />
      <section className="entries-summary" aria-label="Register summary" style={{ marginTop: '1rem' }}>
        <div><p className="label">Open</p><p className="entries-summary__value mono">{s.open + s.investigating}</p></div>
        <div><p className="label">Actions overdue</p><p className={`entries-summary__value mono${overdue > 0 ? ' vr-missing' : ''}`}>{overdue}</p></div>
        <div><p className="label">Closed</p><p className="entries-summary__value mono">{s.closed}</p></div>
      </section>
      <hr className="rule" />
      <p className="label">Open</p>
      {open.length === 0 ? <p className="nil">Nothing open.</p> : open.map(card)}
      {closed.length > 0 && (<><p className="label" style={{ marginTop: '1rem' }}>Closed</p>{closed.map(card)}</>)}
    </main>
  );
}
