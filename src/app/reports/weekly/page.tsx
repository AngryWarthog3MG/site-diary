import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { loadWeeklyData, type WeeklyData } from '@/lib/weekly/load';
import { WeeklyReport, WEEKLY_CSS } from '@/lib/weekly/report';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { GenerateWeeklyPdf, MonthlyBundleButton } from './generate-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Weekly report · Site Diary' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today on site — the project runs on Perth time, whatever the server runs on. */
function perthToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
}

/** The Monday of the week containing `date`. */
function mondayOf(date: string): string {
  const t = new Date(`${date}T00:00:00Z`);
  const back = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * The weekly report on screen (§6): the same template the PDF prints, minus
 * the commentary — that is generated (and paid for) only when a PDF is made.
 */
export default async function WeeklyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; start?: string; end?: string }>;
}) {
  const { memberships } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);

  if (!current) {
    return (
      <main className="sheet">
        <p className="label">Weekly report</p>
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }

  const start =
    params.start && DATE_RE.test(params.start) ? params.start : mondayOf(perthToday());
  const end = params.end && DATE_RE.test(params.end) ? params.end : addDays(start, 6);

  const supabase = await createClient();
  let data: WeeklyData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadWeeklyData(
      supabase,
      {
        id: current.project_id,
        name: current.project.name,
        code: current.project.code,
        orgCode: current.project.org.code,
      },
      start,
      end,
    );
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load the week.';
  }

  const base = `/reports/weekly?project=${current.project_id}`;
  const weekNav = (from: string) => `${base}&start=${from}&end=${addDays(from, 6)}`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DOCKET_CSS + WEEKLY_CSS + PAGE_CSS }} />
      <nav className="weekly-nav">
        <Link href={`/?project=${current.project_id}`}>← Back to today</Link>
        <span className="weekly-nav__range mono">
          {start} — {end}
        </span>
        <span>
          <Link href={weekNav(addDays(start, -7))}>‹ Prev week</Link>
          {' · '}
          <Link href={weekNav(mondayOf(perthToday()))}>This week</Link>
          {' · '}
          <Link href={weekNav(addDays(start, 7))}>Next ›</Link>
        </span>
      </nav>

      {loadError && (
        <main className="docket weekly">
          <p className="nil nil--gap">{loadError}</p>
        </main>
      )}

      {data && data.entries.length === 0 && (
        <main className="docket weekly">
          <header className="head">
            <div>
              <p className="lbl">Weekly site report</p>
              <h1>{current.project.name}</h1>
              <p className="sub">
                {start} to {end}
              </p>
            </div>
          </header>
          <p className="nil nil--gap">
            No signed entries in this period. The weekly report only reports the signed
            record — sign the week&apos;s entries first.
          </p>
        </main>
      )}

      {data && data.entries.length > 0 && (
        <>
          <div className="weekly-actions">
            <GenerateWeeklyPdf projectId={current.project_id} start={start} end={end} />
            <a
              className="button button--outline"
              href={`/api/reports/timesheet?project=${current.project_id}&start=${start}&end=${end}`}
              download
            >
              Timesheet CSV
            </a>
            <MonthlyBundleButton projectId={current.project_id} start={start} />
            <p className="weekly-actions__hint">
              The PDF adds AI commentary above these tables and stores a shareable copy. The
              CSV is the labour matrix for payroll. The month bundle binds every signed
              docket of the month into one document.
            </p>
          </div>
          <WeeklyReport
            data={data}
            narrative={null}
            narrativeNote="Commentary is drafted when the PDF is generated."
          />
        </>
      )}
    </>
  );
}

const PAGE_CSS = `
.weekly-nav {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4mm;
  flex-wrap: wrap;
  width: min(210mm, 100%);
  margin: 0 auto;
  padding: 3mm 2mm 0;
  font-size: 9.5pt;
}
.weekly-nav a { color: #131A1E; }
.weekly-nav__range { color: #5A6469; }
.weekly-actions {
  width: min(210mm, 100%);
  margin: 3mm auto 0;
  padding: 0 2mm;
  display: flex;
  align-items: baseline;
  gap: 4mm;
  flex-wrap: wrap;
}
.weekly-actions__hint { margin: 0; font-size: 8.5pt; color: #5A6469; }
.weekly-actions .button {
  font: inherit;
  padding: 2mm 4mm;
  border: 0.5pt solid #131A1E;
  background: #131A1E;
  color: #FFFFFF;
  cursor: pointer;
}
.weekly-actions .button[disabled] { opacity: 0.6; cursor: default; }
.weekly-actions .button--outline {
  display: inline-block;
  background: #FFFFFF;
  color: #131A1E;
  text-decoration: none;
}
.weekly-actions .weekly-error { margin: 0; font-size: 9pt; color: #A8730A; }
@media print { .weekly-nav, .weekly-actions { display: none; } }
`;
