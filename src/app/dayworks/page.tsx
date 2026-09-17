import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { readRange, type RangeKey } from '@/lib/dayworks/schedule';
import { loadDayworksSchedule, type DayworksScheduleData } from '@/lib/dayworks/load';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dayworks schedule · KBS Daily Diary' };

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/**
 * The dayworks schedule: every daywork on a signed day, the works completed,
 * who and what did it, the docket, and the hours — week by week, totalled —
 * for a period. Printable as the schedule that goes with a claim (README R72).
 */
export default async function DayworksPage({ searchParams }: { searchParams: Promise<{ project?: string; range?: string; from?: string; to?: string }> }) {
  const { memberships } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'claims')) redirect(`/?project=${current.project_id}`);
  guardScreen(current, 'claims');

  const today = perthToday();
  const range = readRange(params, today);
  let data: DayworksScheduleData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadDayworksSchedule(await createClient(), current.project_id, range);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Could not load the schedule.';
  }

  const p = current.project_id;
  const href = (key: RangeKey) => `/dayworks?project=${p}${key === 'all' ? '' : `&range=${key}`}`;
  const pdfHref = `/api/dayworks/pdf?project=${p}${range.key === 'all' ? '' : `&range=${range.key}`}${range.key === 'custom' ? `${range.from ? `&from=${range.from}` : ''}${range.to ? `&to=${range.to}` : ''}` : ''}`;
  const chips: Array<[RangeKey, string]> = [['all', 'Whole job'], ['week', 'This week'], ['month', 'This month'], ['last-month', 'Last month']];

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Dayworks schedule</h1>
      <p className="page-subtitle">Every daywork on a signed day: the works completed, who and what did them, the docket, and the hours, totalled.</p>

      <nav className="chips" aria-label="Period" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.5rem' }}>
        {chips.map(([key, label]) => (
          <Link key={key} href={href(key)} className={`chip chip--link${range.key === key ? ' chip--on' : ''}`} aria-current={range.key === key ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>
      <form method="get" action="/dayworks" className="signin__grid" style={{ alignItems: 'end', marginBottom: '1rem' }}>
        <input type="hidden" name="project" value={p} />
        <input type="hidden" name="range" value="custom" />
        <label className="fieldcell"><span className="label">From</span><input id="dw-from" className="field field--sm" type="date" name="from" defaultValue={range.key === 'custom' ? range.from ?? '' : ''} /></label>
        <label className="fieldcell"><span className="label">To</span><input id="dw-to" className="field field--sm" type="date" name="to" defaultValue={range.key === 'custom' ? range.to ?? '' : ''} /></label>
        <button type="submit" className="button button--quiet">Show these dates</button>
      </form>

      {loadError && <p className="alert">{loadError}</p>}

      {data && (
        <>
          <p className="label">{range.label}</p>
          <div className="claims-summary" aria-label="Totals">
            <div className="claims-tile">
              <span className="label">Total daywork hours</span>
              <strong>{hrs(data.totals.hours)}h</strong>
              <span>{data.totals.hoursNotRecorded ? `${data.totals.hoursNotRecorded} item${data.totals.hoursNotRecorded === 1 ? '' : 's'} with no hours recorded` : 'hours recorded on every item'}</span>
            </div>
            <div className="claims-tile">
              <span className="label">Works completed</span>
              <strong>{data.totals.items}</strong>
              <span>over {data.totals.days} day{data.totals.days === 1 ? '' : 's'}</span>
            </div>
            <div className={`claims-tile${data.totals.toChase > 0 ? ' claims-tile--amber' : ''}`}>
              <span className="label">Dockets</span>
              <strong>{data.totals.docketed}</strong>
              <span>{data.totals.toChase ? `${data.totals.toChase} to chase` : 'all docketed'}</span>
            </div>
          </div>

          <div className="claims-actions">
            <a className="button" href={pdfHref} target="_blank" rel="noopener">Print schedule (PDF)</a>
            <Link className="button button--quiet" href={`/claims?project=${p}`}>Claims register</Link>
          </div>

          {data.truncated && (
            <p className="alert">More than 1,000 dayworks in this period — only the first 1,000 are shown and totalled. Choose a shorter period.</p>
          )}
          {data.unsignedItems > 0 && (
            <p className="notice">{data.unsignedItems} more daywork{data.unsignedItems === 1 ? ' is' : 's are'} on {data.unsignedDays} day{data.unsignedDays === 1 ? '' : 's'} not yet signed. They join the schedule once the day is signed.</p>
          )}

          {data.weeks.length === 0 ? (
            <p className="claims-nil">No dayworks on signed days in this period.</p>
          ) : (
            <div className="claims-tablewrap">
              <table className="claims-table">
                <thead>
                  <tr><th>Date</th><th>Works completed</th><th className="n">Hours</th><th>Docket</th><th>Labour</th><th>Plant</th><th>Materials</th></tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => [
                    <tr key={`wk-${w.start}`} className="dw-week">
                      <td colSpan={2}><strong>Week {fmtDate(w.start)} to {fmtDate(w.end)}</strong></td>
                      <td className="n mono"><strong>{hrs(w.hours)}</strong>{w.hoursNotRecorded ? <span className="claims-flag"> +{w.hoursNotRecorded} not recorded</span> : null}</td>
                      <td colSpan={4} />
                    </tr>,
                    ...w.lines.map((l, i) => (
                      <tr key={`${w.start}-${i}`}>
                        <td className="mono">{l.entryId ? <Link className="claims-cite" href={`/entries/${l.entryId}/signed`}>{fmtDate(l.date)}</Link> : fmtDate(l.date)}</td>
                        <td>{l.works}</td>
                        <td className={`n mono${l.hours == null ? ' claims-flag' : ''}`}>{l.hours == null ? 'Not recorded' : hrs(l.hours)}</td>
                        <td className={l.docket ? 'mono' : 'claims-flag'}>{l.docket ?? 'To chase'}{l.docketAddedOn ? <span className="vr-note">added {fmtDate(l.docketAddedOn)}</span> : null}</td>
                        <td>{l.labour ?? '—'}</td>
                        <td>{l.plant ?? '—'}</td>
                        <td>{l.materials ?? '—'}</td>
                      </tr>
                    )),
                  ])}
                  <tr className="dw-total">
                    <td colSpan={2}><strong>Total: {data.totals.items} item{data.totals.items === 1 ? '' : 's'} of work over {data.totals.days} day{data.totals.days === 1 ? '' : 's'}</strong></td>
                    <td className="n mono"><strong>{hrs(data.totals.hours)}</strong></td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
