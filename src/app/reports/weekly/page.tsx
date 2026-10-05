import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, sees } from '@/lib/auth';
import { canExportReports } from '@/lib/roles';
import { loadWeeklyData, type WeeklyData } from '@/lib/weekly/load';
import { WeeklyReport, WEEKLY_CSS } from '@/lib/weekly/report';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { GenerateWeeklyPdf, MonthlyBundleButton } from './generate-button';
import { fmtDate } from '@/lib/pdf/dates';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Weekly report · Kooboolong IMS' };

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
  searchParams: Promise<{ project?: string; start?: string; end?: string; tab?: string }>;
}) {
  const { memberships } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);
  guardScreen(current, 'weekly');

  if (!current) {
    return (
      <main className="sheet">
        <p className="label">Weekly report</p>
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }

  const supabase = await createClient();

  /**
   * Which week to open on.
   *
   * The current one, normally. But on a Monday — or any week whose days are
   * still drafts — the current week is empty, and opening on "nothing to
   * report" tells a PM nothing about a job that has been running for months.
   * So when this week holds no signed day, fall back to the most recent week
   * that does, and say on screen that is what happened.
   */
  let fellBackTo: string | null = null;
  let start = params.start && DATE_RE.test(params.start) ? params.start : mondayOf(perthToday());
  if (!params.start) {
    const { data: latest } = await supabase
      .from('entries')
      .select('entry_date')
      .eq('project_id', current.project_id)
      .eq('status', 'signed')
      .order('entry_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const thisWeek = start;
    const hasThisWeek = await supabase
      .from('entries')
      .select('id')
      .eq('project_id', current.project_id)
      .eq('status', 'signed')
      .gte('entry_date', thisWeek)
      .lte('entry_date', addDays(thisWeek, 6))
      .limit(1)
      .maybeSingle();
    if (!hasThisWeek.data && latest?.entry_date) {
      start = mondayOf(latest.entry_date as string);
      fellBackTo = start;
    }
  }
  const end = params.end && DATE_RE.test(params.end) ? params.end : addDays(start, 6);
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
      // A report that leaves out the days you have not signed yet tells the
      // reader something false about the job. They are in, and marked.
      { includeUnsigned: true },
    );
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load the week.';
  }

  // Two tabs (README R109): the week's report, and the week's prestarts in one PDF.
  const canPrestarts = sees(current, 'prestart');
  const tab: 'report' | 'prestarts' = params.tab === 'prestarts' && canPrestarts ? 'prestarts' : 'report';
  const base = `/reports/weekly?project=${current.project_id}`;
  const weekNav = (from: string) => `${base}&start=${from}&end=${addDays(from, 6)}${tab === 'prestarts' ? '&tab=prestarts' : ''}`;
  const tabHref = (t: 'report' | 'prestarts') => `${base}&start=${start}&end=${end}${t === 'prestarts' ? '&tab=prestarts' : ''}`;
  type PrestartRow = { id: string; prestart_date: string; supervisor_name: string | null; completed_at: string | null; prestart_attendees: Array<{ count: number }> };
  const prestarts: PrestartRow[] = tab === 'prestarts'
    ? (((await supabase.from('prestarts').select('id, prestart_date, supervisor_name, completed_at, prestart_attendees(count)')
        .eq('project_id', current.project_id).gte('prestart_date', start).lte('prestart_date', end)
        .order('prestart_date').order('created_at')).data ?? []) as unknown as PrestartRow[])
    : [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DOCKET_CSS + WEEKLY_CSS + PAGE_CSS }} />
      <main className="weekly-shell">
        <section className="weekly-hero">
          <div>
            <p className="weekly-kicker"><BrandMark size={18} /> Weekly report</p>
            <h1>{current.project.name}</h1>
            <p className="weekly-range mono">
              {fmtDate(start)} to {fmtDate(end)}
            </p>
          </div>
          <Link className="weekly-back" href={`/?project=${current.project_id}`}>
            Home
          </Link>
        </section>

        <nav className="weekly-nav" aria-label="Week">
          <Link href={weekNav(addDays(start, -7))}>← Week before</Link>
          <Link href={weekNav(mondayOf(perthToday()))}>This week</Link>
          <Link href={weekNav(addDays(start, 7))}>Week after →</Link>
        </nav>

        {canPrestarts && (
          <nav className="weekly-tabs" aria-label="What to show">
            <Link href={tabHref('report')} className={tab === 'report' ? 'is-on' : undefined} aria-current={tab === 'report' ? 'page' : undefined}>Weekly report</Link>
            <Link href={tabHref('prestarts')} className={tab === 'prestarts' ? 'is-on' : undefined} aria-current={tab === 'prestarts' ? 'page' : undefined}>Prestarts</Link>
          </nav>
        )}

        {tab === 'prestarts' && (
          <section className="weekly-prestarts">
            <div className="weekly-prestarts__head">
              <h2>Prestarts, {fmtDate(start)} to {fmtDate(end)}</h2>
              {prestarts.some((r) => r.completed_at) && (
                <a className="button" href={`/api/reports/weekly/prestarts?project=${current.project_id}&start=${start}&end=${end}`} target="_blank" rel="noopener">
                  The week’s prestarts — one PDF
                </a>
              )}
              {prestarts.some((r) => r.completed_at) && (
                <a className="button button--quiet" href={`/api/reports/weekly/prestarts?project=${current.project_id}&start=${start}&end=${end}&copy=client`} target="_blank" rel="noopener" title="For the head contractor: the prestarts that were recorded, without the app's induction check beside the sign-ons">
                  Client copy — one PDF
                </a>
              )}
            </div>
            {prestarts.length === 0 ? (
              <p className="weekly-prestarts__none">No prestarts this week.</p>
            ) : (
              <ul className="weekly-prestarts__list">
                {prestarts.map((r) => {
                  const count = r.prestart_attendees?.[0]?.count ?? 0;
                  return (
                    <li key={r.id}>
                      <Link href={`/prestart/${r.id}?project=${current.project_id}`}>
                        <strong>{new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${r.prestart_date}T00:00:00Z`))} {fmtDate(r.prestart_date)}</strong>
                        <span>{r.supervisor_name ?? '—'} · {count} signed on</span>
                        <span className={r.completed_at ? 'is-done' : 'is-open'}>{r.completed_at ? 'Finished' : 'Not finished — not in the PDF'}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="weekly-prestarts__hint">One PDF with a cover listing every day — who ran it, how many signed on, the page it starts on, and working days with no prestart — then each finished prestart exactly as its own PDF prints it, signatures and all.</p>
          </section>
        )}

        {tab === 'report' && fellBackTo && (
          <p className="weekly-fallback">
            Nothing signed this week yet, so this is the most recent week with signed days.
          </p>
        )}

      {tab === 'report' && loadError && (
        <section className="weekly-state weekly-state--error">
          <p className="weekly-kicker">Could not load</p>
          <h2>Weekly report unavailable</h2>
          <p>{loadError}</p>
        </section>
      )}

      {tab === 'report' && data && data.entries.length === 0 && (
        <section className="weekly-state">
          <p className="weekly-kicker">Nothing recorded this week</p>
          <h2>Nothing to report yet</h2>
          <p>
            No days recorded in this period at all — signed or otherwise. Record a day and
            it will appear here, marked as a draft until you sign it.
          </p>
        </section>
      )}

      {tab === 'report' && data && data.entries.length > 0 && (
        <>
          {canExportReports(current.role) ? (
          <div className="weekly-actions">
            <a
              className="button"
              href={`/api/reports/weekly/internal?project=${current.project_id}&start=${start}&end=${end}`}
              download
            >
              Download PDF
            </a>
            <a
              className="button button--outline"
              href={`/api/reports/timesheet?project=${current.project_id}&start=${start}&end=${end}`}
              download
            >
              Hours as a spreadsheet
            </a>
            <a
              className="button button--outline"
              href={`/api/reports/timesheet?project=${current.project_id}&start=${start}&end=${end}&format=long`}
              download
            >
              Timesheet for payroll — this week
            </a>
            <a
              className="button button--outline"
              href={`/api/reports/timesheet?project=${current.project_id}&start=${addDays(start, -7)}&end=${end}&format=long`}
              download
            >
              Timesheet for payroll — fortnight to {fmtDate(end)}
            </a>
            <GenerateWeeklyPdf projectId={current.project_id} start={start} end={end} />
            <MonthlyBundleButton projectId={current.project_id} start={start} />
            <p className="weekly-actions__hint">
              Download PDF is this page as a document, for wages and progress. The spreadsheet is
              the labour matrix; the timesheet for payroll is one line per person per day with
              ordinary and overtime hours apart, the clocks, and the diary each line stands on —
              the shape the office imports or keys in. The client report adds AI commentary, marks every
              figure from a day not yet signed, and stores a shareable copy. The month bundle
              binds every signed docket of the month into one document.
            </p>
          </div>
          ) : (
            <p className="way-hint">The exports — PDFs, the payroll spreadsheet, the month bundle — are for the office; you can read the week here.</p>
          )}
          <WeeklyReport data={data} narrative={null} audience="internal" />
        </>
      )}
      </main>
    </>
  );
}

const PAGE_CSS = `
.weekly-tabs { width: min(210mm, calc(100vw - 8mm)); margin: 3mm auto 0; display: flex; gap: 0.4rem; flex-wrap: wrap; }
.weekly-tabs a { padding: 0.5rem 1rem; border-radius: 999px; border: 1px solid var(--rule, #d5d8d2); background: var(--paper); color: var(--ink); text-decoration: none; font-weight: 600; font-size: 0.92rem; }
.weekly-tabs a.is-on { background: var(--teal); border-color: var(--teal); color: #fff; }
.weekly-prestarts { width: min(210mm, calc(100vw - 8mm)); margin: 4mm auto 0; padding: 6mm; background: var(--paper); border-radius: 12px; box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,.08)); display: grid; gap: 0.75rem; }
.weekly-prestarts__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; }
.weekly-prestarts__head h2 { margin: 0; font-size: 1.15rem; }
.weekly-prestarts__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.weekly-prestarts__list a { display: grid; grid-template-columns: minmax(8rem, auto) 1fr auto; gap: 0.25rem 0.9rem; align-items: baseline; padding: 0.65rem 0.8rem; border: 1px solid var(--rule, #d5d8d2); border-radius: 10px; color: inherit; text-decoration: none; }
.weekly-prestarts__list .is-done { color: var(--teal); font-weight: 600; font-size: 0.88rem; }
.weekly-prestarts__list .is-open { color: #8a5a00; font-weight: 600; font-size: 0.88rem; }
.weekly-prestarts__none, .weekly-prestarts__hint { margin: 0; color: var(--ink-60, #5b665f); font-size: 0.9rem; }
@media (max-width: 560px) { .weekly-prestarts__list a { grid-template-columns: 1fr; } }
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
.weekly-fallback {
  margin: 0.5rem 0 0;
  padding: 0.6rem 0.85rem;
  background: rgba(240, 164, 31, 0.12);
  border-radius: 8px;
  color: #6b4a06;
  font-size: 0.875rem;
  line-height: 1.4;
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
.weekly-actions .bundle-parts { display: grid; gap: 2mm; }
.weekly-actions .bundle-parts .button { text-align: center; white-space: normal; }
.weekly-actions .bundle-parts .caption { margin: 0; font-size: 9pt; }
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
