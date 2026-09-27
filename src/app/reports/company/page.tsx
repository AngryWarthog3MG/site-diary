import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { addDays, dmy, fmtHours, readWeek, weekOf } from '@/lib/timesheets/model';
import { loadCompanyWeek } from '@/lib/weekly/company-load';
import { loadTimesheet } from '@/lib/timesheets/load';
import { TimesheetTable } from '@/app/timesheets/timesheet-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Weekly report, all jobs · Kooboolong IMS' };

const n = (v: number) => (v ? fmtHours(v) : '·');

/**
 * The company's weekly report (README R108): every job's week side by side, the company's totals, what needs
 * attention, then a few lines per job and the door to its full report. Every figure is the job's own weekly figure.
 * No money, and no model-written words.
 */
export default async function CompanyWeeklyPage({ searchParams }: { searchParams: Promise<{ project?: string; week?: string }> }) {
  const { memberships } = await requireUser();
  const { project, week } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'company_weekly');

  const supabase = await createClient();
  const today = perthToday();
  const thisWeek = weekOf(today);
  let start = readWeek(week, today);
  const ours = memberships.filter((m) => m.project.org.id === current.project.org.id);
  let data = await loadCompanyWeek(supabase, ours, start, addDays(start, 6));
  // On a Monday nothing is recorded yet: open on last week, and say so.
  let fellBack = false;
  if (!week && data.jobs.every((j) => j.workingDaysRecorded === 0 && j.restDaysWorked === 0)) {
    start = addDays(start, -7);
    data = await loadCompanyWeek(supabase, ours, start, addDays(start, 6));
    fellBack = true;
  }
  const end = addDays(start, 6);
  // Everyone's hours for pay across this company's jobs (README R109): the Timesheets page's loader and table, so the
  // hours read the same in both — names combined, two-jobs-at-once flagged.
  const pay = await loadTimesheet(supabase, start, { projectIds: ours.filter((m) => m.project.active).map((m) => m.project_id) });
  const at = (m: string) => `/reports/company?project=${current.project_id}&week=${m}`;
  const t = data.totals;

  return (
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Weekly report — all jobs</h1>
      <p className="page-subtitle">
        Every job’s week side by side: diaries, labour, plant, concrete, delays, variations and dayworks, then what needs
        attention. Each figure is the job’s own weekly report, added up. Days not signed yet are in, and marked.
      </p>

      <nav className="chips" aria-label="Week" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.75rem' }}>
        <Link href={at(addDays(start, -7))} className="chip chip--link">‹ Week before</Link>
        <span className="chip chip--on" aria-current="page">{fmtDate(start)} to {fmtDate(end)}</span>
        {start < thisWeek && <Link href={at(addDays(start, 7))} className="chip chip--link">Week after ›</Link>}
        {start !== thisWeek && <Link href={at(thisWeek)} className="chip chip--link">This week</Link>}
      </nav>
      {fellBack && <p className="caption">Nothing is recorded this week yet, so this is last week.</p>}
      {data.failed.map((f) => <p key={f.code} className="alert">{f.code} {f.name}: {f.message}</p>)}

      {data.jobs.length === 0 ? <p className="claims-nil">No jobs to report on.</p> : (
        <>
          <div className="claims-tablewrap">
            <table className="cw-table">
              <thead>
                <tr>
                  <th>Job</th><th>Diaries</th><th>Labour h</th><th>People</th><th>Plant h</th><th>Concrete m³</th>
                  <th>Delays h</th><th>Variations</th><th>Dayworks h</th><th>Rain mm</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.projectId}>
                    <td><a href={`#job-${j.code}`} className="cw-job"><strong>{j.code}</strong> <span className="cw-sub">{j.name}</span></a></td>
                    <td className={j.workingDaysRecorded < j.workingDays ? 'cw-warn' : undefined}>
                      {j.notStarted ? <span className="cw-sub">not started</span> : <>{j.workingDaysRecorded}/{j.workingDays}{j.restDaysWorked ? ` +${j.restDaysWorked}` : ''}</>}
                      {j.unsignedDays.length > 0 && <span className="cw-sub">{j.unsignedDays.length} not signed</span>}
                    </td>
                    <td>{n(j.labourHours)}{j.overtimeHours ? <span className="cw-sub">{fmtHours(j.overtimeHours)} OT</span> : null}</td>
                    <td>{j.people.length || '·'}</td>
                    <td>{n(j.plantHours)}{j.plantIdle ? <span className="cw-sub">{fmtHours(j.plantIdle)} idle</span> : null}</td>
                    <td>{n(j.concreteM3)}</td>
                    <td>{n(j.delayHours)}{j.topDelay ? <span className="cw-sub">{j.topDelay}</span> : null}</td>
                    <td>{j.variations || '·'}{j.variationsUnnumbered ? <span className="cw-sub cw-warn">{j.variationsUnnumbered} no number</span> : null}</td>
                    <td>{n(j.dayworkHours)}{j.dayworksWithoutDocket ? <span className="cw-sub cw-warn">{j.dayworksWithoutDocket} no docket</span> : null}</td>
                    <td>{n(j.rainMm)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>All {t.jobs} job{t.jobs === 1 ? '' : 's'}</td>
                  <td>{t.workingDaysMissing ? `${t.workingDaysMissing} missing` : 'all in'}</td>
                  <td>{n(t.labourHours)}{t.overtimeHours ? <span className="cw-sub">{fmtHours(t.overtimeHours)} OT</span> : null}</td>
                  <td>{t.people || '·'}</td>
                  <td>{n(t.plantHours)}</td>
                  <td>{n(t.concreteM3)}</td>
                  <td>{n(t.delayHours)}</td>
                  <td>{t.variations || '·'}</td>
                  <td>{n(t.dayworkHours)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="caption">Diaries: working days with a diary, out of Monday to Friday from the day the job began; +n is weekend days worked. People counts one person on two jobs once.</p>

          <section className="cw-attention">
            <p className="label">Needs attention</p>
            {data.attention.length === 0 ? <p className="caption">Nothing: every working day has a signed diary, every variation has a number, every daywork a docket.</p> : (
              <ul className="plainlist">
                {data.attention.map((a, i) => <li key={i}><strong>{a.code}</strong> {a.text}</li>)}
              </ul>
            )}
          </section>

          <section className="cw-pay" id="hours">
            <div className="cw-job-head">
              <h2>Hours for pay — everyone, every job</h2>
              <Link href={`/timesheets?project=${current.project_id}&week=${start}`}>Timesheets ›</Link>
            </div>
            {pay.sheet.people.length === 0
              ? <p className="caption">No labour recorded in any diary this week.</p>
              : <TimesheetTable sheet={pay.sheet} pendingCorrections={pay.pendingCorrections} />}
            <p className="caption">One row per person across every job, as the diaries recorded them. If one person shows twice under different names, combine them on Timesheets. A red day is someone on two jobs at the same time — check both diaries before paying.</p>
          </section>

          {data.jobs.map((j) => (
            <section key={j.projectId} id={`job-${j.code}`} className="cw-job-section">
              <div className="cw-job-head">
                <h2>{j.code} · {j.name}</h2>
                <Link href={`/reports/weekly?project=${j.projectId}&start=${start}&end=${end}`}>Full weekly report ›</Link>
              </div>
              <p className="caption">
                {j.notStarted ? 'Not started — no start date and no diary yet' : `${j.workingDaysRecorded} of ${j.workingDays} working days recorded`}{j.unsignedDays.length ? ` · not signed: ${j.unsignedDays.map((d) => dmy(d).slice(0, 5)).join(', ')}` : ''}
                {' · '}{fmtHours(j.labourHours)} h labour, {j.people.length} {j.people.length === 1 ? 'person' : 'people'}
                {j.instructions ? ` · ${j.instructions} instruction${j.instructions === 1 ? '' : 's'} recorded` : ''}
              </p>
              {j.done.length > 0 && (<><p className="label">Work done</p><ul className="cw-list">{j.done.map((d, i) => <li key={i}>{d}</li>)}</ul></>)}
              {j.delays.length > 0 && (<><p className="label">Delays</p><ul className="cw-list">{j.delays.map((d, i) => <li key={i}><span className="mono">{dmy(d.date).slice(0, 5)}</span> {d.cause}{d.hours != null ? ` — ${fmtHours(d.hours)} h` : ''}</li>)}</ul></>)}
              {j.variationRows.length > 0 && (<><p className="label">Variations</p><ul className="cw-list">{j.variationRows.map((v, i) => <li key={i}><span className="mono">{dmy(v.date).slice(0, 5)}</span> {v.number ?? 'No number'} — {v.description}</li>)}</ul></>)}
              {j.done.length === 0 && j.delays.length === 0 && j.variationRows.length === 0 && <p className="caption">No work items, delays or variations recorded this week.</p>}
            </section>
          ))}

          <div className="claims-actions" style={{ marginTop: '1.25rem' }}>
            <a className="button" href={`/api/reports/company?project=${current.project_id}&week=${start}`} target="_blank" rel="noopener">Weekly report, all jobs (PDF)</a>
          </div>
        </>
      )}
    </main>
  );
}
