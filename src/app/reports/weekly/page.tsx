import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
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
      <main className="weekly-shell">
        <section className="weekly-hero">
          <div>
            <p className="weekly-kicker"><BrandMark size={18} /> Weekly report</p>
            <h1>{current.project.name}</h1>
            <p className="weekly-range mono">
              {start} to {end}
            </p>
          </div>
          <Link className="weekly-back" href={`/?project=${current.project_id}`}>
            Back to today
          </Link>
        </section>

        <nav className="weekly-nav" aria-label="Week">
          <Link href={weekNav(addDays(start, -7))}>Prev week</Link>
          <Link href={weekNav(mondayOf(perthToday()))}>This week</Link>
          <Link href={weekNav(addDays(start, 7))}>Next week</Link>
        </nav>

      {loadError && (
        <section className="weekly-state weekly-state--error">
          <p className="weekly-kicker">Could not load</p>
          <h2>Weekly report unavailable</h2>
          <p>{loadError}</p>
        </section>
      )}

      {data && data.entries.length === 0 && (
        <section className="weekly-state">
          <p className="weekly-kicker">No signed entries</p>
          <h2>Nothing to report yet</h2>
          <p>
            No signed entries in this period. The weekly report only reports the signed
            record — sign the week&apos;s entries first.
          </p>
        </section>
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
      </main>
    </>
  );
}

const PAGE_CSS = `
.weekly-shell {
  min-height: 100vh;
  padding: 8mm 4mm 12mm;
  background:
    linear-gradient(rgba(22, 33, 31, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(22, 33, 31, 0.025) 1px, transparent 1px),
    linear-gradient(180deg, var(--paper-dim) 0%, var(--desk) 54%, var(--desk-deep) 100%);
  background-size: 8mm 8mm, 8mm 8mm, auto;
}
.weekly-hero {
  width: min(210mm, calc(100vw - 8mm));
  margin: 0 auto;
  padding: 10mm;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8mm;
  border-radius: 5mm;
  background:
    linear-gradient(135deg, var(--teal-deep) 0%, var(--teal) 48%, color-mix(in srgb, var(--teal) 62%, #9ec9ae) 100%);
  color: #FFFFFF;
  box-shadow: 0 12mm 24mm rgba(22, 33, 31, 0.16);
}
.weekly-kicker {
  margin: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 8.5pt;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.weekly-hero h1 {
  margin: 2mm 0 0;
  max-width: 14ch;
  color: #FFFFFF;
  font-size: clamp(28pt, 7vw, 54pt);
  line-height: 0.96;
  letter-spacing: 0;
}
.weekly-range {
  display: inline-flex;
  margin: 5mm 0 0;
  padding: 2mm 3mm;
  border: 0.4pt solid rgba(255, 255, 255, 0.22);
  border-radius: 2mm;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.86);
  font-size: 9pt;
}
.weekly-back {
  flex: 0 0 auto;
  padding: 2.5mm 4mm;
  border: 0.4pt solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.1);
  text-decoration: none;
  font-size: 9pt;
  font-weight: 700;
}
.weekly-nav {
  display: flex;
  justify-content: center;
  gap: 2.5mm;
  flex-wrap: wrap;
  width: min(210mm, 100%);
  margin: 4mm auto;
  padding: 2mm;
  border: 0.4pt solid rgba(22, 33, 31, 0.08);
  border-radius: 3.5mm;
  background: rgba(255, 255, 255, 0.68);
  box-shadow: 0 1mm 5mm rgba(22, 33, 31, 0.07);
  font-size: 9pt;
}
.weekly-nav a {
  min-width: 32mm;
  padding: 2.5mm 4mm;
  border-radius: 2.5mm;
  color: var(--teal);
  text-align: center;
  text-decoration: none;
  font-weight: 700;
}
.weekly-nav a:hover {
  background: var(--teal-tint);
}
.weekly-actions {
  width: min(210mm, 100%);
  margin: 0 auto 4mm;
  padding: 4mm;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3mm;
  border: 0.4pt solid color-mix(in srgb, var(--teal) 14%, transparent);
  border-radius: 4mm;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--teal-tint) 96%, transparent), color-mix(in srgb, var(--amber-tint) 90%, transparent));
  box-shadow: 0 3mm 12mm rgba(22, 33, 31, 0.08);
}
.weekly-actions__hint {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 1mm;
  font-size: 8.5pt;
  color: var(--ink-60);
}
.weekly-actions .button {
  width: 100%;
  min-height: 13mm;
  margin: 0;
  padding: 2mm 4mm;
  border: 0;
  border-radius: 3mm;
  background: linear-gradient(180deg, color-mix(in srgb, var(--teal) 80%, #6fae8f) 0%, var(--teal) 58%, var(--teal-deep) 100%);
  color: #FFFFFF;
  box-shadow: 0 1mm 3mm color-mix(in srgb, var(--teal) 24%, transparent);
  cursor: pointer;
  font: inherit;
  font-size: 9pt;
  font-weight: 700;
  text-align: center;
}
.weekly-actions .button[disabled] { opacity: 0.6; cursor: default; }
.weekly-actions .button--outline {
  background: #FFFFFF;
  border: 0.4pt solid color-mix(in srgb, var(--teal) 20%, transparent);
  color: var(--teal);
  text-decoration: none;
  box-shadow: 0 1mm 3mm rgba(22, 33, 31, 0.06);
}
.weekly-actions .weekly-error { margin: 0; font-size: 9pt; color: var(--amber); }
.weekly-state {
  width: min(210mm, calc(100vw - 8mm));
  margin: 0 auto;
  padding: 10mm;
  border: 0.4pt solid color-mix(in srgb, var(--amber) 22%, transparent);
  border-radius: 4mm;
  background: linear-gradient(180deg, var(--amber-tint), #FFFFFF);
  box-shadow: 0 3mm 14mm rgba(22, 33, 31, 0.08);
}
.weekly-state .weekly-kicker { color: var(--amber); }
.weekly-state h2 {
  margin: 2mm 0 0;
  font-size: 22pt;
  letter-spacing: 0;
}
.weekly-state p:last-child {
  max-width: 120mm;
  color: var(--ink-60);
  font-size: 10pt;
}
.weekly-state--error {
  border-color: color-mix(in srgb, var(--signal) 24%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--signal) 9%, #ffffff), #FFFFFF);
}
.weekly-state--error .weekly-kicker { color: var(--signal); }
.weekly-shell .docket.weekly {
  margin-top: 0;
  box-shadow:
    0 1mm 1mm rgba(22, 33, 31, 0.04),
    0 10mm 24mm rgba(22, 33, 31, 0.14);
}
@media (max-width: 760px) {
  .weekly-shell { padding: 3mm 2mm 8mm; }
  .weekly-hero {
    display: block;
    width: calc(100vw - 4mm);
    padding: 7mm;
  }
  .weekly-hero h1 { font-size: 30pt; }
  .weekly-back {
    display: inline-flex;
    margin-top: 6mm;
  }
  .weekly-actions {
    grid-template-columns: 1fr;
  }
  .weekly-nav {
    width: calc(100vw - 4mm);
  }
  .weekly-nav a {
    flex: 1 1 30%;
    min-width: 0;
  }
}
@media print { .weekly-nav, .weekly-actions { display: none; } }
`;
