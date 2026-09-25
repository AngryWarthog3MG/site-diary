import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { perthToday } from '@/lib/push/decide';
import { loadTimesheet } from '@/lib/timesheets/load';
import { DAY_LABELS, addDays, dm, dmy, fmtHours, readWeek, weekOf } from '@/lib/timesheets/model';
import { isRestDay } from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timesheets · Kooboolong IMS' };

/**
 * The company timesheet (README R103): one sheet for the week, everyone on it,
 * every job the account is on, read from the diary's labour rows. A person on two
 * jobs is one row with the jobs told apart. Office lens — pm and admin.
 */
export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ project?: string; week?: string }> }) {
  const { memberships } = await requireUser();
  const { project, week } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'timesheets');

  const supabase = await createClient();
  const today = perthToday();
  const monday = readWeek(week, today);
  const thisWeek = weekOf(today);
  const { sheet, pendingCorrections } = await loadTimesheet(supabase, monday);
  const p = current.project_id;
  const at = (m: string) => `/timesheets?project=${p}${m === thisWeek ? '' : `&week=${m}`}`;
  const pdfHref = `/api/timesheets/pdf?project=${p}&week=${monday}`;
  const jobsOnSheet = sheet.jobs.length;

  return (
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Timesheets</h1>
      <p className="page-subtitle">
        Everyone’s hours for the week, across every job, on one sheet — as the diaries recorded them. A person on two
        jobs is one row with the jobs told apart. Hours come from the diary’s labour list; a day not signed yet is marked.
      </p>

      <nav className="chips" aria-label="Week" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.75rem', alignItems: 'center' }}>
        <Link href={at(addDays(monday, -7))} className="chip chip--link">‹ Week before</Link>
        <span className="chip chip--on" aria-current="page">Week of {dmy(monday)}</span>
        {monday < thisWeek && <Link href={at(addDays(monday, 7))} className="chip chip--link">Week after ›</Link>}
        {monday !== thisWeek && <Link href={at(thisWeek)} className="chip chip--link">This week</Link>}
      </nav>

      {sheet.people.length === 0 ? (
        <p className="claims-nil">No labour recorded in any diary for the week of {dmy(monday)}.</p>
      ) : (
        <>
          <p className="caption">
            {sheet.people.length} {sheet.people.length === 1 ? 'person' : 'people'} · {jobsOnSheet} {jobsOnSheet === 1 ? 'job' : 'jobs'} · {fmtHours(sheet.total)} h
            {sheet.overtime ? ` (+ ${fmtHours(sheet.overtime)} h overtime)` : ''}
            {sheet.unsignedRows ? ` · ${sheet.unsignedRows} ${sheet.unsignedRows === 1 ? 'row' : 'rows'} on days not signed yet` : ''}
            {sheet.noHours ? ` · ${sheet.noHours} ${sheet.noHours === 1 ? 'row' : 'rows'} with no hours recorded` : ''}
            {pendingCorrections ? ` · ${pendingCorrections} correction${pendingCorrections === 1 ? '' : 's'} not signed yet (the original counts until it is)` : ''}
          </p>

          <div className="claims-tablewrap">
            <table className="timesheet">
              <thead>
                <tr>
                  <th>Person</th>
                  {sheet.days.map((d, i) => (
                    <th key={d} className={isRestDay(d) ? 'ts-rest' : undefined}>{DAY_LABELS[i]}<span className="ts-job">{dm(d)}</span></th>
                  ))}
                  <th>Total</th>
                  <th>Jobs</th>
                </tr>
              </thead>
              <tbody>
                {sheet.people.map((person) => {
                  const multi = Object.keys(person.byJob).length > 1;
                  return (
                    <tr key={person.key}>
                      <td>
                        <span className="ts-name">{person.name}</span>
                        {person.roles.length > 0 && <span className="ts-job">{person.roles.join(' / ')}</span>}
                      </td>
                      {sheet.days.map((d) => {
                        const cell = person.days[d];
                        if (!cell) return <td key={d} className={isRestDay(d) ? 'ts-rest' : undefined}>·</td>;
                        const href = cell.entryIds.length === 1 ? `/entries/${cell.entryIds[0]}/${cell.unsigned ? 'review' : 'signed'}` : null;
                        const text = `${fmtHours(cell.hours)}${cell.overtime ? ` +${fmtHours(cell.overtime)}` : ''}`;
                        return (
                          <td key={d} className={cell.unsigned ? 'ts-unsigned' : undefined} title={cell.unsigned ? 'Day not signed yet' : cell.noHours ? 'Hours not recorded' : undefined}>
                            {href ? <Link href={href} className="ts-cell">{text}</Link> : text}
                            {multi && <span className="ts-job">{cell.jobs.join(' + ')}</span>}
                            {cell.unsigned && <span className="ts-job">not signed</span>}
                          </td>
                        );
                      })}
                      <td className="ts-total">{fmtHours(person.total)}{person.overtime ? <span className="ts-job">+{fmtHours(person.overtime)} OT</span> : null}</td>
                      <td className="ts-jobs">{Object.entries(person.byJob).map(([code, h]) => `${code} ${fmtHours(h)}`).join(' · ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>All</td>
                  {sheet.days.map((d) => <td key={d}>{sheet.dayTotals[d] ? fmtHours(sheet.dayTotals[d]) : '·'}</td>)}
                  <td>{fmtHours(sheet.total)}</td>
                  <td className="ts-jobs">{sheet.jobs.map((j) => `${j.code} ${fmtHours(j.hours)}`).join(' · ')}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="label" style={{ marginTop: '1.25rem' }}>By job</p>
          <ul className="plainlist">
            {sheet.jobs.map((j) => (
              <li key={j.projectId} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--ink-08)' }}>
                <b>{j.code}</b> {j.name} — {fmtHours(j.hours)} h, {j.people} {j.people === 1 ? 'person' : 'people'}
              </li>
            ))}
          </ul>

          <div className="claims-actions" style={{ marginTop: '1rem' }}>
            <a className="button" href={pdfHref} target="_blank" rel="noopener">Timesheet (PDF)</a>
          </div>
        </>
      )}
    </main>
  );
}
