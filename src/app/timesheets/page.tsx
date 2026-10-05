import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { perthToday } from '@/lib/push/decide';
import { loadTimesheet } from '@/lib/timesheets/load';
import { addDays, dmy, fmtHours, normName, readWeek, weekOf } from '@/lib/timesheets/model';
import { AddTime } from './add-time';
import { CombineNames } from './combine-names';
import { TimesheetTable } from './timesheet-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timesheets · Kooboolong IMS' };

/**
 * The company timesheet (README R103): one sheet for the week, everyone on it,
 * every job the account is on, read from the diary's labour rows. A person on two
 * jobs is one row with the jobs told apart. Time with no diary behind it — a day at
 * the office — is added here by hand and marked as such (README R122). Admin.
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
  const orgId = current.project.org.id;
  const ourJobs = memberships.filter((m) => m.project.org.id === orgId).map((m) => m.project_id);
  const [{ sheet, pendingCorrections, combined, added }, crew, members] = await Promise.all([
    loadTimesheet(supabase, monday, { orgIds: [orgId] }),
    supabase.from('crew').select('name').in('project_id', ourJobs).eq('active', true),
    supabase.from('project_members').select('user_id').in('project_id', ourJobs),
  ]);
  const memberIds = [...new Set((members.data ?? []).map((m) => m.user_id as string))];
  const { data: profiles } = memberIds.length ? await supabase.from('profiles').select('full_name').in('id', memberIds) : { data: [] };
  // Names to offer on Add time: the week's sheet, the crews, the members — one spelling each. Any other can be typed.
  const offered = new Map<string, string>();
  for (const n of [...sheet.people.map((pp) => pp.name), ...(profiles ?? []).map((pr) => (pr.full_name as string | null) ?? ''), ...(crew.data ?? []).map((c) => String(c.name ?? ''))]) {
    const name = n.replace(/\s+/g, ' ').trim();
    if (name && !offered.has(normName(name))) offered.set(normName(name), name);
  }
  const p = current.project_id;
  const at = (m: string) => `/timesheets?project=${p}${m === thisWeek ? '' : `&week=${m}`}`;
  const pdfHref = `/api/timesheets/pdf?project=${p}&week=${monday}`;

  return (
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Timesheets</h1>
      <p className="page-subtitle">
        Everyone’s hours for the week, across every job, on one sheet — as the diaries recorded them. A person on two
        jobs is one row with the jobs told apart. Hours come from the diary’s labour list; a day not signed yet is marked.
        Time with no diary behind it, such as a day at the office, is added below and marked with where it was worked.
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
          <TimesheetTable sheet={sheet} pendingCorrections={pendingCorrections} />

          <p className="label" style={{ marginTop: '1.25rem' }}>By job</p>
          <ul className="plainlist">
            {sheet.jobs.map((j) => (
              <li key={j.projectId} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--ink-08)' }}>
                <b>{j.code}</b> {j.name} — {fmtHours(j.hours)} h, {j.people} {j.people === 1 ? 'person' : 'people'}{j.office ? ' · not a job' : ''}
              </li>
            ))}
          </ul>

          <div className="claims-actions" style={{ marginTop: '1rem' }}>
            <a className="button" href={pdfHref} target="_blank" rel="noopener">Timesheet (PDF)</a>
          </div>
        </>
      )}

      <AddTime
        orgId={orgId} projectId={p} monday={monday} today={today}
        people={[...offered.values()].sort((a, b) => a.localeCompare(b))}
        added={added.filter((a) => a.orgId === orgId)}
      />

      <CombineNames
        orgId={current.project.org.id}
        names={[...new Set(sheet.people.flatMap((pp) => [pp.name, ...pp.aka]))].sort((a, b) => a.localeCompare(b))}
        combined={combined.filter((c) => c.orgId === current.project.org.id)}
      />
    </main>
  );
}
