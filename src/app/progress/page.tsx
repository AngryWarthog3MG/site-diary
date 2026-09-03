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
      <h1 className="page-title">How far along each area is</h1>
      <p className="page-subtitle">
        Taken from the days you have signed. An area only moves when a supervisor says it
        moved — nothing here is estimated, and nothing creeps up on its own.
      </p>
      <hr className="rule" />

      {loadError && <p className="notice gap">{loadError}</p>}

      {data && data.series.length === 0 && (
        <p className="claims-nil">
          Nothing to chart yet. Say how far along an area is when you record the day — or
          type it into the works section — and it starts building a line here.
        </p>
      )}

      {data && data.charted.length > 0 && (
        <>
          <ProgressChart series={data.charted} dates={data.dates} />
          {data.series.length > data.charted.length && (
            <p className="claims-total">
              The chart shows the {MAX_CHARTED} areas worked on most recently, so the lines
              stay readable. Every area is in the table underneath.
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
                <th className="n">Now at</th>
                <th>Last said</th>
                <th className="n">Times recorded</th>
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
