import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isDate } from '@/lib/api';
import { loadTraining } from '@/lib/training/load';
import { COURSE_KIND_LABEL, RESULT_LABEL, trainingReport } from '@/lib/training/courses';
import { defaultPeriod } from '@/lib/training/period';
import { fmtDay } from '@/lib/registers/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training report · Kooboolong IMS' };

/** Completed training and training hours over a period (README R188) — the whole company, from the classes' attendances. */
export default async function TrainingReportPage({ searchParams }: { searchParams: Promise<{ project?: string; from?: string; to?: string }> }) {
  const { memberships } = await requireUser();
  const { project, from: fromParam, to: toParam } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'training');
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const d = defaultPeriod(today);
  const from = isDate(fromParam) ? fromParam : d.from;
  const to = isDate(toParam) ? toParam : d.to;
  const data = await loadTraining(supabase, org.id);
  const report = from <= to ? trainingReport(data.attendees, data.classes, data.courses, data.ticketsByAttendee, from, to) : null;
  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Training report</h1>
      <p className="page-subtitle">Every attendance on a class in the period, by person, with the hours and the result. Hours come from the attendance — given, else the class&rsquo;s clocks, else the course&rsquo;s duration; an attendance without them is listed as not recorded, never counted as nought.</p>
      <form method="get" action="/training/report" className="regs__pick">
        <input type="hidden" name="project" value={current.project_id} />
        <label className="fieldcell"><span className="label">From</span><input className="field field--sm" type="date" name="from" defaultValue={from} /></label>
        <label className="fieldcell"><span className="label">To</span><input className="field field--sm" type="date" name="to" defaultValue={to} max={today} /></label>
        <button type="submit" className="button">Show</button>
        {report && <a className="button button--quiet" href={`/api/training/report/pdf${q}&from=${from}&to=${to}`} target="_blank" rel="noopener">PDF</a>}
      </form>
      <div className="photo-add-pair">
        <Link className="button button--quiet" href={`/training/classes${q}`}>Classes</Link>
        <Link className="button button--quiet" href={`/training${q}`}>Training matrix</Link>
      </div>
      {!report && <p className="alert" role="alert">The period is two days, the first not after the second.</p>}
      {report && (<>
        <section className="entries-summary" aria-label="Summary" style={{ marginTop: '1rem' }}>
          <div><p className="label">Attendances</p><p className="entries-summary__value mono">{report.attended}</p></div>
          <div><p className="label">People</p><p className="entries-summary__value mono">{report.people.length}</p></div>
          <div><p className="label">Hours recorded</p><p className="entries-summary__value mono">{report.totalHours}</p></div>
          <div><p className="label">Not recorded</p><p className={`entries-summary__value mono${report.unrecorded > 0 ? ' vr-missing' : ''}`}>{report.unrecorded}</p></div>
          <div><p className="label">Competent</p><p className="entries-summary__value mono">{report.passed}</p></div>
          <div><p className="label">Not yet</p><p className="entries-summary__value mono">{report.failed}</p></div>
        </section>
        <h2 style={{ marginTop: '1.25rem' }}>Hours by person</h2>
        {report.people.length === 0 ? <p className="caption">No training attended between {fmtDay(from)} and {fmtDay(to)}.</p> : (
          <div className="matrix__scroll"><table className="matrix__table">
            <thead><tr><th>Name</th><th>Attendances</th><th>Hours</th><th>Competent</th><th>Not yet</th></tr></thead>
            <tbody>{report.people.map((p) => <tr key={p.person_name}><td><strong>{p.person_name}</strong></td><td className="mono">{p.lines}</td><td className="mono">{p.hours > 0 ? `${p.hours} h` : 'not recorded'}{p.unrecorded > 0 && p.hours > 0 ? <span className="caption"> · {p.unrecorded} without hours</span> : null}</td><td className="mono">{p.passed}</td><td className="mono">{p.failed}</td></tr>)}</tbody>
          </table></div>
        )}
        {report.lines.length > 0 && (<>
          <h2 style={{ marginTop: '1.25rem' }}>Completed training</h2>
          <div className="matrix__scroll"><table className="matrix__table">
            <thead><tr><th>Name</th><th>Day</th><th>Course</th><th>Trainer / provider</th><th>Hours</th><th>Result</th><th>Ticket</th></tr></thead>
            <tbody>{report.lines.map((l) => (
              <tr key={`${l.class_id}-${l.person_name}`}>
                <td>{l.person_name}</td>
                <td className="mono">{fmtDay(l.day)}</td>
                <td><Link href={`/training/classes/${l.class_id}${q}`}>{l.course_code} {l.course_name}</Link><br /><span className="caption">{COURSE_KIND_LABEL[l.kind]}{l.unit_of_competency ? ` · ${l.unit_of_competency}` : ''}</span></td>
                <td>{l.provider === 'external' ? l.provider_name ?? '—' : l.trainer_name ?? '—'}</td>
                <td className="mono">{l.hours == null ? 'not recorded' : `${l.hours} h`}</td>
                <td>{l.result ? RESULT_LABEL[l.result] : '—'}</td>
                <td>{l.ticketRecorded ? 'Recorded' : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>)}
      </>)}
    </main>
  );
}
