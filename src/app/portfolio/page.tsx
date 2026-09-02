import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'All jobs · KBS Daily Diary' };

/**
 * The owner's screen: every active job at a glance — the week's rhythm, the
 * gaps, the last signature, and the money sitting on the claims register.
 * Reads run under the caller's own RLS, so each person sees exactly their
 * own portfolio.
 */
export default async function PortfolioPage() {
  const { memberships } = await requireUser();
  const projects = memberships.filter((m) => m.project.active);
  const supabase = await createClient();

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(
    new Date(),
  );
  const since = (() => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 6);
    return t.toISOString().slice(0, 10);
  })();

  // One query per concern, across ALL the caller's projects at once.
  const ids = projects.map((p) => p.project_id);
  const [{ data: recent }, { data: firsts }, { data: lastSigned }, claims] = await Promise.all([
    supabase
      .from('entries')
      .select('project_id, entry_date, status')
      .in('project_id', ids)
      .gte('entry_date', since),
    supabase.from('entries').select('project_id, entry_date').in('project_id', ids).order('entry_date'),
    supabase
      .from('entries')
      .select('project_id, entry_no, entry_date')
      .in('project_id', ids)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false }),
    supabase.rpc(
      'run_diary_query',
      {
        p_sql:
          `select d.project_id, ` +
          `(select coalesce(sum(duration_mins), 0) from diary.delays x where x.project_id = d.project_id) as delay_mins, ` +
          `(select coalesce(sum(estimated_cost), 0) from diary.variations x where x.project_id = d.project_id) as variation_cost, ` +
          `(select coalesce(sum(hours), 0) from diary.dayworks x where x.project_id = d.project_id) as daywork_hours ` +
          `from diary.entries d group by d.project_id`,
        p_limit: 100,
      },
      { get: true },
    ),
  ]);

  const claimRows = ((claims.data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []);
  const claimsBy = new Map(claimRows.map((r) => [String(r.project_id), r]));
  const firstBy = new Map<string, string>();
  for (const row of firsts ?? []) {
    if (!firstBy.has(row.project_id as string)) firstBy.set(row.project_id as string, row.entry_date as string);
  }
  const lastBy = new Map<string, { entry_no: string; entry_date: string }>();
  for (const row of lastSigned ?? []) {
    if (!lastBy.has(row.project_id as string)) {
      lastBy.set(row.project_id as string, {
        entry_no: row.entry_no as string,
        entry_date: row.entry_date as string,
      });
    }
  }
  const statusBy = new Map<string, Map<string, string>>();
  for (const row of recent ?? []) {
    const days = statusBy.get(row.project_id as string) ?? new Map<string, string>();
    const existing = days.get(row.entry_date as string);
    if (row.status === 'signed' || !existing) days.set(row.entry_date as string, row.status as string);
    statusBy.set(row.project_id as string, days);
  }

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const week = (projectId: string) => {
    const days: Array<{ date: string; label: string; state: string }> = [];
    const first = firstBy.get(projectId);
    const cursor = new Date(`${today}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() - 6);
    for (let i = 0; i < 7; i += 1) {
      const date = cursor.toISOString().slice(0, 10);
      const status = statusBy.get(projectId)?.get(date);
      days.push({
        date,
        label: DOW[cursor.getUTCDay()],
        state: status === 'signed' ? 'signed' : status ? 'draft' : date === today ? 'today' : !first || date < first ? 'idle' : 'gap',
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  };

  return (
    <main className="sheet sheet--wide">
      <p className="label">
        <BrandMark size={18} withName />
      </p>
      <h1 className="page-title">All jobs</h1>
      <p className="page-subtitle">
        Every active job at a glance: the week&apos;s rhythm, the last signature, and what is
        sitting on the claims register.
      </p>
      <hr className="rule" />

      {projects.length === 0 && <p className="notice gap">No active projects.</p>}

      <div className="portfolio">
        {projects.map((m) => {
          const claim = claimsBy.get(m.project_id);
          const delayHours = claim ? Math.round((Number(claim.delay_mins) / 60) * 10) / 10 : 0;
          const variationCost = claim ? Number(claim.variation_cost) : 0;
          const dayworkHours = claim ? Number(claim.daywork_hours) : 0;
          const last = lastBy.get(m.project_id);
          const gaps = week(m.project_id).filter((d) => d.state === 'gap').length;
          return (
            <article key={m.project_id} className="portfolio-card">
              <header>
                <p className="label">{m.project.org.code}-{m.project.code}</p>
                <h2>{m.project.name}</h2>
              </header>
              <div className="weekstrip">
                {week(m.project_id).map((day) => (
                  <span
                    key={day.date}
                    className={`weekstrip__day weekstrip__day--${day.state}`}
                    title={day.date}
                  >
                    {day.label}
                  </span>
                ))}
              </div>
              <dl className="portfolio-stats">
                <div>
                  <dt>Last signed</dt>
                  <dd className="mono">{last ? `${last.entry_no}` : '—'}</dd>
                </div>
                <div>
                  <dt>Gaps this week</dt>
                  <dd className={gaps > 0 ? 'portfolio-warn' : ''}>{gaps}</dd>
                </div>
                <div>
                  <dt>Standdown</dt>
                  <dd>{delayHours} h</dd>
                </div>
                <div>
                  <dt>Variations</dt>
                  <dd>${variationCost.toLocaleString('en-AU')}</dd>
                </div>
                <div>
                  <dt>Dayworks</dt>
                  <dd>{dayworkHours} h</dd>
                </div>
              </dl>
              <div className="portfolio-links">
                <Link className="button button--quiet" href={`/?project=${m.project_id}`}>
                  Today
                </Link>
                <Link className="button button--quiet" href={`/claims?project=${m.project_id}`}>
                  Claims
                </Link>
                <Link className="button button--quiet" href={`/reports/weekly?project=${m.project_id}`}>
                  Weekly
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
