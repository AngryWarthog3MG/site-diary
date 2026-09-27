import Link from 'next/link';
import { isRestDay } from '@/lib/calendar';
import { DAY_LABELS, dm, fmtHours, type Timesheet } from '@/lib/timesheets/model';

/**
 * Everyone's hours for the week, one row per person across every job (README R103, R107). Drawn by the Timesheets page
 * and by the all-jobs weekly (R109) from the same loader, so the hours a person is paid for read the same in both.
 */
export function TimesheetTable({ sheet, pendingCorrections }: { sheet: Timesheet; pendingCorrections: number }) {
  const jobsOnSheet = sheet.jobs.length;
  return (
    <>
            <p className="caption">
              {sheet.people.length} {sheet.people.length === 1 ? 'person' : 'people'} · {jobsOnSheet} {jobsOnSheet === 1 ? 'job' : 'jobs'} · {fmtHours(sheet.total)} h
              {sheet.overtime ? ` (+ ${fmtHours(sheet.overtime)} h overtime)` : ''}
              {sheet.unsignedRows ? ` · ${sheet.unsignedRows} ${sheet.unsignedRows === 1 ? 'row' : 'rows'} on days not signed yet` : ''}
              {sheet.noHours ? ` · ${sheet.noHours} ${sheet.noHours === 1 ? 'row' : 'rows'} with no hours recorded` : ''}
              {pendingCorrections ? ` · ${pendingCorrections} correction${pendingCorrections === 1 ? '' : 's'} not signed yet (the original counts until it is)` : ''}
              {sheet.clashes ? ` · ${sheet.clashes} day${sheet.clashes === 1 ? '' : 's'} where someone is on two jobs at once — check` : ''}
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
                          {person.aka.length > 0 && <span className="ts-job ts-aka">also written {person.aka.join(', ')}</span>}
                        </td>
                        {sheet.days.map((d) => {
                          const cell = person.days[d];
                          if (!cell) return <td key={d} className={isRestDay(d) ? 'ts-rest' : undefined}>·</td>;
                          const href = cell.entryIds.length === 1 ? `/entries/${cell.entryIds[0]}/${cell.unsigned ? 'review' : 'signed'}` : null;
                          const text = `${fmtHours(cell.hours)}${cell.overtime ? ` +${fmtHours(cell.overtime)}` : ''}`;
                          return (
                            <td key={d} className={[cell.unsigned ? 'ts-unsigned' : '', cell.clash ? 'ts-clash' : ''].filter(Boolean).join(' ') || undefined} title={cell.clash ? 'On two jobs at the same time — check both diaries' : cell.unsigned ? 'Day not signed yet' : cell.noHours ? 'Hours not recorded' : undefined}>
                              {href ? <Link href={href} className="ts-cell">{text}</Link> : text}
                              {multi && <span className="ts-job">{cell.jobs.join(' + ')}</span>}
                              {cell.unsigned && <span className="ts-job">not signed</span>}
                              {cell.clash && <span className="ts-job ts-clash__note">two jobs at once</span>}
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
    </>
  );
}
