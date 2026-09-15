import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { canSee, type Screen } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { KIND_LABEL, incidentRef, type IncidentKind } from '@/lib/incidents/model';
import { VERDICT_LABEL, type Verdict } from '@/lib/subcontractors/model';
import { loadDashboard, perthBadge, OPEN_LIST } from '@/lib/home/dashboard';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The "View report" foot every card ends with. */
function Foot({ href, label = 'View report' }: { href: string; label?: string }) {
  return (
    <p className="dash-card__foot">
      <Link href={href}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="1" y="6" width="2.5" height="5" fill="currentColor" /><rect x="4.75" y="2" width="2.5" height="9" fill="currentColor" /><rect x="8.5" y="4" width="2.5" height="7" fill="currentColor" /></svg>
        {label}
      </Link>
    </p>
  );
}

function Big({ n, tone }: { n: number | string; tone?: 'bad' | 'ok' }) {
  return <p className={`dash-card__big mono${tone ? ` dash-card__big--${tone}` : ''}`}>{n}</p>;
}

function Badge({ iso }: { iso: string }) {
  const b = perthBadge(iso);
  return <span className="dash-date"><span className="dash-date__day mono">{b.day}</span><span className="dash-date__mon">{b.mon}</span></span>;
}

/**
 * The cards under the diary: every figure read from the record through the
 * safety dashboard's own loader, so the home and the dashboard never disagree.
 * Streamed in after the page shell — a phone with one bar of signal gets the
 * diary first and the numbers as they arrive.
 */
export async function DashboardCards({ projectId, orgId, role }: { projectId: string; orgId: string; role: MemberRole }) {
  const supabase = await createClient();
  const today = perthToday();
  const d = await loadDashboard(supabase, projectId, orgId, today);
  const s = d.safety;
  const q = `?project=${projectId}`;
  const see = (screen: Screen) => canSee(role, screen);
  const trunc = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
  const maxMonth = Math.max(1, ...s.incidents.months.map((m) => m.total));
  const swmsUnsigned = s.swms.length;

  return (
    <>
      {see('training') && (
        <section className="dash-card">
          <p className="dash-card__title">Expired tickets &amp; licences</p>
          <Big n={s.tickets.expired.length} tone={s.tickets.expired.length > 0 ? 'bad' : undefined} />
          <p className="dash-card__sub">{s.tickets.soon.length > 0 ? `${s.tickets.soon.length} more expiring within 30 days` : 'None expiring within 30 days'}</p>
          <Foot href={`/training${q}`} />
        </section>
      )}
      {see('safety') && (
        <section className="dash-card">
          <p className="dash-card__title">Actions overdue</p>
          <Big n={s.actions.overdue} tone={s.actions.overdue > 0 ? 'bad' : undefined} />
          <p className="dash-card__sub">of {s.actions.open} corrective action{s.actions.open === 1 ? '' : 's'} open</p>
          <Foot href={`/safety${q}`} />
        </section>
      )}
      {see('orders') && (
        <section className="dash-card">
          <p className="dash-card__title">Orders &amp; plant issues</p>
          <Big n={d.orders.toOrder + d.orders.issues} tone={d.orders.urgent > 0 ? 'bad' : undefined} />
          <p className="dash-card__sub">{d.orders.toOrder} to order · {d.orders.ordered} ordered · {d.orders.issues} plant issue{d.orders.issues === 1 ? '' : 's'}{d.orders.urgent > 0 ? ` · ${d.orders.urgent} urgent` : ''}</p>
          <Foot href={`/orders${q}`} />
        </section>
      )}
      {see('permits') && (
        <section className="dash-card">
          <p className="dash-card__title">Permits to work</p>
          <Big n={s.permits.live} />
          <p className="dash-card__sub">live now{s.permits.expired > 0 ? ` · ${s.permits.expired} past ${s.permits.expired === 1 ? 'its' : 'their'} window, not closed` : ''}</p>
          <Foot href={`/permits${q}`} />
        </section>
      )}
      {see('incidents') && (
        <section className="dash-card dash-card--list">
          <p className="dash-card__title">Uncontrolled hazards</p>
          {d.openIncidents.length === 0 ? <p className="dash-card__nil">Nothing open. Every report is closed.</p> : (
            <ul className="dash-list">
              {d.openIncidents.slice(0, OPEN_LIST).map((i) => (
                <li key={i.id}>
                  <Link className="dash-row" href={`/incidents/${i.id}${q}`}>
                    <Badge iso={i.occurred_at} />
                    <span className="dash-row__text">
                      <span className="dash-row__name">{incidentRef(i.seq)} · {KIND_LABEL[i.kind as IncidentKind] ?? i.kind}</span>
                      <span className="dash-row__what">{trunc(i.description)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {d.openIncidents.length > OPEN_LIST && <p className="dash-card__sub">and more open</p>}
          <Foot href={`/incidents${q}`} label="Hazards & incidents" />
        </section>
      )}
      {see('procedures') && (
        <section className="dash-card dash-card--list">
          <p className="dash-card__title">Latest documents</p>
          {d.latestDocuments.length === 0 ? <p className="dash-card__nil">No policies or procedures issued yet.</p> : (
            <ul className="dash-list">
              {d.latestDocuments.map((v) => (
                <li key={v.id}>
                  <span className="dash-row">
                    <Badge iso={v.issued_at} />
                    <span className="dash-row__text">
                      <span className="dash-row__name">{v.title}</span>
                      <span className="dash-row__what">Version {v.version}{v.summary ? ` · ${trunc(v.summary, 60)}` : ''}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Foot href={`/procedures${q}`} label="Policies & procedures" />
        </section>
      )}
      {see('incidents') && (
        <section className="dash-card">
          <p className="dash-card__title">Hazards reported <span className="dash-card__when">Last 30 days</span></p>
          <Big n={d.last30.reported} />
          <div className="dash-split">
            <span><strong className="mono">{d.last30.closed}</strong>Controlled<i className="dash-dot dash-dot--ok" /></span>
            <span><strong className="mono">{d.last30.open}</strong>Uncontrolled<i className="dash-dot dash-dot--bad" /></span>
          </div>
          <Foot href={`/incidents${q}`} />
        </section>
      )}
      {see('incidents') && (
        <section className="dash-card">
          <p className="dash-card__title">Number of injuries <span className="dash-card__when">Last 30 days</span></p>
          <Big n={d.last30.injuries} tone={d.last30.injuries > 0 ? 'bad' : undefined} />
          <p className="dash-card__sub">{s.incidents.daysSinceInjury == null ? 'No injury ever recorded on this job' : `${s.incidents.daysSinceInjury} days since the last injury`}</p>
          <Foot href={`/incidents${q}`} />
        </section>
      )}
      {see('safety') && (
        <section className="dash-card dash-card--chart">
          <p className="dash-card__title">Frequency rate <span className="dash-card__when">12-month rolling</span></p>
          <Big n={s.incidents.year.ratePerMillionHours == null ? '—' : s.incidents.year.ratePerMillionHours} />
          <p className="dash-card__sub">medical-treatment-or-worse injuries per million hours · {s.incidents.year.hoursWorked.toLocaleString('en-AU')} h on signed diaries</p>
          <div className="safety__months dash-months" aria-label="Reports by month">
            {s.incidents.months.map((m) => (
              <div key={m.month} className="safety__month">
                <div className="safety__bar" style={{ height: `${Math.round((m.total / maxMonth) * 100)}%` }} title={`${m.total} reports`} />
                <span className="caption">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</span>
              </div>
            ))}
          </div>
          <Foot href={`/safety${q}`} />
        </section>
      )}
      {see('inspections') && (
        <section className="dash-card">
          <p className="dash-card__title">Inspections <span className="dash-card__when">Last 90 days</span></p>
          <Big n={s.inspections.last90} />
          <p className="dash-card__sub">{s.inspections.issuesOpen > 0 ? `${s.inspections.issuesOpen} finding${s.inspections.issuesOpen === 1 ? '' : 's'} still open` : 'No findings open'}</p>
          <Foot href={`/inspections${q}`} />
        </section>
      )}
      {see('swms') && (
        <section className="dash-card">
          <p className="dash-card__title">SWMS not signed by everyone</p>
          <Big n={swmsUnsigned} tone={swmsUnsigned > 0 ? 'bad' : 'ok'} />
          <p className="dash-card__sub">{swmsUnsigned > 0 ? trunc(s.swms.map((x) => `${x.title} v${x.version}`).join(' · '), 80) : 'Everyone on the crew list has signed every SWMS in use'}</p>
          <Foot href={`/swms${q}`} label="SWMS & JSA" />
        </section>
      )}
      {see('subcontractors') && (
        <section className="dash-card">
          <p className="dash-card__title">Subcontractors not compliant</p>
          <Big n={s.subcontractors.length} tone={s.subcontractors.length > 0 ? 'bad' : 'ok'} />
          <p className="dash-card__sub">{s.subcontractors.length > 0 ? trunc(s.subcontractors.map((x) => `${x.name} — ${VERDICT_LABEL[x.verdict as Verdict]}`).join(' · '), 90) : 'Everyone engaged here is compliant, or nobody is engaged'}</p>
          <Foot href={`/subcontractors${q}`} />
        </section>
      )}
      <p className="dash-asof caption">As of {fmtDate(today)} · every number read from the record</p>
    </>
  );
}

/** What the cards' places look like while the numbers arrive. */
export function DashboardSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <section key={i} className="dash-card dash-card--skeleton" aria-hidden>
          <p className="dash-card__title">&nbsp;</p>
          <p className="dash-card__big mono">&nbsp;</p>
        </section>
      ))}
    </>
  );
}
