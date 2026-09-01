import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { loadProgressData, MAX_CHARTED, type ProgressData } from '@/lib/progress/load';
import { BrandMark } from '@/components/brand-mark';
import { ProgressChart } from './progress-chart';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progress · KBS Daily Diary' };

/** Percent-complete per area across the project's life, from the signed record. */
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }

  let data: ProgressData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadProgressData(await createClient(), current.project_id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load progress.';
  }

  return (
    <main className="sheet sheet--wide">
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">Progress</h1>
      <p className="page-subtitle">
        Percent complete per area, as recorded in signed entries. An area only moves when a
        supervisor says it moved.
      </p>
      <hr className="rule" />

      {loadError && <p className="notice gap">{loadError}</p>}

      {data && data.series.length === 0 && (
        <p className="claims-nil">
          No percentages on the record yet. When a supervisor gives an area a percent
          complete — spoken or on review — it charts here.
        </p>
      )}

      {data && data.charted.length > 0 && (
        <>
          <ProgressChart series={data.charted} dates={data.dates} />
          {data.series.length > data.charted.length && (
            <p className="claims-total">
              Charting the {MAX_CHARTED} most recently active areas; every area is in the
              table.
            </p>
          )}
        </>
      )}

      {data && data.series.length > 0 && (
        <div className="claims-tablewrap" style={{ marginTop: '1rem' }}>
          <table className="claims-table">
            <thead>
              <tr>
                <th>Area</th>
                <th className="n">Latest %</th>
                <th>As of</th>
                <th className="n">Points</th>
              </tr>
            </thead>
            <tbody>
              {data.series.map((s) => (
                <tr key={s.area}>
                  <td>{s.area}</td>
                  <td className="n mono">{s.latest}%</td>
                  <td className="mono">{s.latestDate}</td>
                  <td className="n mono">{s.points.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr className="rule" />
      <Link className="button button--quiet" href={`/?project=${current.project_id}`}>
        Back to today
      </Link>
    </main>
  );
}
