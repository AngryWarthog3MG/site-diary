import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { loadSafety } from '@/lib/safety/load';
import { VERDICT_LABEL, type Verdict } from '@/lib/subcontractors/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Safety · Kooboolong IMS' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One screen for the office: what is open, what is late, what is expiring, and the numbers a client asks for. */
export default async function SafetyPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'safety')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const d = await loadSafety(supabase, current.project_id, current.project.org.id, perthToday());
  const q = `?project=${current.project_id}`;
  const tile = (label: string, value: string | number, tone?: 'bad' | 'ok', href?: string) => (
    <div className={`safety__tile${tone === 'bad' ? ' safety__tile--bad' : tone === 'ok' ? ' safety__tile--ok' : ''}`}>
      <p className="label">{label}</p>
      <p className="entries-summary__value mono">{value}</p>
      {href && <Link className="caption" href={`${href}${q}`}>Open</Link>}
    </div>
  );
  const maxMonth = Math.max(1, ...d.incidents.months.map((m) => m.total));
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Safety</h1>
      <p className="page-subtitle">Every number here is read from the record, today. Nothing is typed in. <a href={`/api/safety/pdf?project=${current.project_id}`} target="_blank" rel="noopener">Monthly safety report (PDF)</a></p>

      <p className="label">Today</p>
      <div className="safety__tiles">
        {tile('On site now', d.onSiteNow, undefined, '/signin')}
        {tile('Prestart', d.prestartToday === 'done' ? 'Done' : d.prestartToday === 'open' ? 'Open' : 'None', d.prestartToday === 'done' ? 'ok' : d.prestartToday === 'none' ? 'bad' : undefined, '/prestart')}
        {tile('Permits live', d.permits.live, undefined, '/permits')}
        {tile('Permits past window', d.permits.expired, d.permits.expired > 0 ? 'bad' : undefined, '/permits')}
        {tile('Plant tagged out', d.taggedOut.length, undefined, '/plant')}
        {tile('Gate sign-ins, 7 days', d.signInsThisWeek, undefined, '/signin')}
      </div>
      {d.taggedOut.length > 0 && <p className="caption">Tagged out: {d.taggedOut.join(', ')}</p>}

      <p className="label" style={{ marginTop: '1.25rem' }}>Actions</p>
      <div className="safety__tiles">
        {tile('Open', d.actions.open, undefined, '/incidents')}
        {tile('Overdue', d.actions.overdue, d.actions.overdue > 0 ? 'bad' : 'ok')}
        {tile('Reports open', d.incidents.open, undefined, '/incidents')}
        {tile('Inspections, 90 days', d.inspections.last90, undefined, '/inspections')}
      </div>
      {d.actions.list.length > 0 && (
        <table className="safety__table">
          <thead><tr><th>Due</th><th>Action</th><th>Owner</th><th>From</th></tr></thead>
          <tbody>
            {d.actions.list.map((a, i) => (
              <tr key={i} className={a.due_on && a.due_on < d.today ? 'safety__late' : ''}>
                <td className="mono">{a.due_on ? fmtDate(a.due_on) : '—'}</td>
                <td>{a.action}</td>
                <td>{a.owner ?? '—'}</td>
                <td><Link href={`${a.href}${q}`}>{a.ref}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.actions.open > d.actions.list.length && (
        <p className="caption">Showing the {d.actions.list.length} due soonest; {d.actions.open - d.actions.list.length} more open under <Link href={`/incidents${q}`}>Incidents</Link> and <Link href={`/inspections${q}`}>Inspections</Link>.</p>
      )}

      <p className="label" style={{ marginTop: '1.25rem' }}>Injuries and reports, last 12 months</p>
      <div className="safety__tiles">
        {tile('Days since last injury (ever)', d.incidents.daysSinceInjury == null ? 'No injury recorded' : d.incidents.daysSinceInjury, d.incidents.daysSinceInjury == null ? 'ok' : undefined)}
        {tile('Medical treatment or worse', d.incidents.year.mti, d.incidents.year.mti > 0 ? 'bad' : 'ok')}
        {tile('First aid', d.incidents.year.fai)}
        {tile('Injuries, no treatment or not stated', d.incidents.year.untreated)}
        {tile('Near misses', d.incidents.year.nearMiss)}
        {tile('Hazards reported', d.incidents.year.hazards)}
        {tile('Notifiable', d.incidents.year.notifiable, d.incidents.year.notifiable > 0 ? 'bad' : undefined)}
        {tile('Hours worked (signed diaries)', d.incidents.year.hoursWorked.toLocaleString('en-AU'))}
        {tile('Injury rate / million hours', d.incidents.year.ratePerMillionHours == null ? '—' : d.incidents.year.ratePerMillionHours)}
      </div>
      <p className="caption">The rate is medical-treatment-or-worse injuries per million hours, hours being the labour on signed diaries. Lost-time days are not recorded yet, so this is not an LTIFR.</p>
      <div className="safety__months" aria-label="Reports by month">
        {d.incidents.months.map((m) => (
          <div key={m.month} className="safety__month">
            <div className="safety__bar" style={{ height: `${Math.round((m.total / maxMonth) * 100)}%` }} title={`${m.total} reports`} />
            <span className="mono caption">{m.total}</span>
            <span className="caption">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</span>
          </div>
        ))}
      </div>

      <p className="label" style={{ marginTop: '1.25rem' }}>Expiring and outstanding</p>
      <div className="item">
        <p className="label">Tickets</p>
        {d.tickets.expired.length === 0 && d.tickets.soon.length === 0 ? <p className="nil">Nothing expired or expiring within 30 days for this job&rsquo;s crew.</p> : (
          <>
            {d.tickets.expired.map((t, i) => <p key={`e${i}`} className="vr-missing">{t.person} — {t.label} expired {fmtDate(t.on)}</p>)}
            {d.tickets.soon.map((t, i) => <p key={`s${i}`}>{t.person} — {t.label} expires {fmtDate(t.on)}</p>)}
          </>
        )}
        <Link className="caption" href={`/training${q}`}>Training matrix</Link>
      </div>
      <div className="item">
        <p className="label">Subcontractors engaged here</p>
        {d.subcontractors.length === 0 ? <p className="nil">Everyone engaged is compliant, or nobody is engaged.</p> : d.subcontractors.map((s) => <p key={s.name} className="vr-missing">{s.name} — {VERDICT_LABEL[s.verdict as Verdict]}</p>)}
        <Link className="caption" href={`/subcontractors${q}`}>Subcontractors</Link>
      </div>
      <div className="item">
        <p className="label">SWMS in use, not yet signed by</p>
        {d.swms.length === 0 ? <p className="nil">Everyone on the crew list has signed every SWMS in use.</p> : d.swms.map((s) => <p key={s.title}>{s.title} v{s.version} — {s.unsigned.join(', ')}</p>)}
        <Link className="caption" href={`/swms${q}`}>SWMS &amp; JSA</Link>
      </div>
      <div className="item">
        <p className="label">Documents not yet read by</p>
        {d.documents.length === 0 ? <p className="nil">Everyone on the crew list has read every current document.</p> : d.documents.map((x) => <p key={x.title}>{x.title} v{x.version} — {x.unread.join(', ')}</p>)}
        <Link className="caption" href={`/procedures${q}`}>Policies &amp; procedures</Link>
      </div>
    </main>
  );
}
