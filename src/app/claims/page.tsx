import Link from 'next/link';
import { DraftClaimButton } from './draft-button';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { loadClaimsData, type ClaimsData } from '@/lib/claims/load';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Claims · KBS Daily Diary' };

/**
 * The claims register: the whole project's delays, variations and dayworks
 * on one screen, every line linking to its signed entry. This is the page a
 * contracts administrator lives on — the evidence, already organised.
 */
export default async function ClaimsPage({
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

  let data: ClaimsData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadClaimsData(await createClient(), {
      id: current.project_id,
      name: current.project.name,
      code: current.project.code,
      orgCode: current.project.org.code,
    });
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load the register.';
  }

  const entryLink = (entryNo: string) => {
    const id = data?.entryIds[entryNo];
    return id ? `/entries/${id}/signed` : null;
  };
  const Cite = ({ entryNo }: { entryNo: string }) => {
    const href = entryLink(entryNo);
    return href ? (
      <Link className="mono claims-cite" href={href}>
        {entryNo}
      </Link>
    ) : (
      <span className="mono">{entryNo}</span>
    );
  };
  const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-AU')}`);

  return (
    <main className="sheet sheet--wide">
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">What you can claim for</h1>
      <p className="page-subtitle">
        Every delay, variation and daywork you have signed off, across the whole job. Each
        line names the day it came from, so anything here can be traced back and stands up
        months later.
      </p>
      <div style={{ margin: '0.75rem 0' }}>
        <a
          className="button button--quiet"
          style={{ width: 'auto', display: 'inline-block' }}
          href={`/api/reports/claims?project=${current.project_id}`}
          download
        >
          Download as a spreadsheet
        </a>{' '}
        <DraftClaimButton projectId={current.project_id} />
      </div>
      <hr className="rule" />

      {loadError && <p className="notice gap">{loadError}</p>}

      {data && (
        <>
          <section style={{ marginTop: '1rem' }}>
            <p className="label">
              Time lost · {data.delays.rows.length} event
              {data.delays.rows.length === 1 ? '' : 's'}
            </p>
            {data.delays.rows.length === 0 ? (
              <p className="claims-nil">
                Nothing yet. Delays turn up here once you sign a day that has one.
              </p>
            ) : (
              <>
                <p className="claims-total">
                  {data.delays.totalHours} hours of standdown · {data.delays.manHoursLost}{' '}
                  man-hours lost ·{' '}
                  {data.delays.byCategory
                    .map((c) => `${c.category} ${c.hours}h (${c.events})`)
                    .join(' · ')}
                </p>
                <div className="claims-tablewrap">
                  <table className="claims-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entry</th>
                        <th>Cause</th>
                        <th>Category</th>
                        <th className="n">Mins</th>
                        <th className="n">Crew</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.delays.rows.map((row, index) => (
                        <tr key={index}>
                          <td className="mono">{row.date}</td>
                          <td>
                            <Cite entryNo={row.entry_no} />
                          </td>
                          <td>{row.cause}</td>
                          <td>{row.category ?? '—'}</td>
                          <td className="n mono">{row.duration_mins ?? '—'}</td>
                          <td className="n mono">{row.personnel_affected ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <hr className="rule" />

          <section>
            <p className="label">
              Variations · {data.variations.rows.length}
              {data.variations.unreferenced > 0 && (
                <span className="claims-flag">
                  {' '}
                  {data.variations.unreferenced} without a VR reference
                </span>
              )}
            </p>
            {data.variations.rows.length === 0 ? (
              <p className="claims-nil">
                Nothing yet. Variations turn up here once you sign a day that has one.
              </p>
            ) : (
              <>
                <p className="claims-total">
                  Estimated value directed: {money(data.variations.totalCost)}
                </p>
                <div className="claims-tablewrap">
                  <table className="claims-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entry</th>
                        <th>VR ref</th>
                        <th>Description</th>
                        <th>Directed by</th>
                        <th className="n">Est. cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.variations.rows.map((row, index) => (
                        <tr key={index}>
                          <td className="mono">{row.date}</td>
                          <td>
                            <Cite entryNo={row.entry_no} />
                          </td>
                          <td className={row.vr_ref ? 'mono' : 'claims-flag'}>
                            {row.vr_ref ?? 'NO VR REF'}
                          </td>
                          <td>{row.description}</td>
                          <td>{row.directed_by ?? '—'}</td>
                          <td className="n mono">{money(row.estimated_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <hr className="rule" />

          <section>
            <p className="label">
              Dayworks · {data.dayworks.rows.length}
              {data.dayworks.missingDockets > 0 && (
                <span className="claims-flag"> {data.dayworks.missingDockets} without a docket</span>
              )}
            </p>
            {data.dayworks.rows.length === 0 ? (
              <p className="claims-nil">
                Nothing yet. Dayworks turn up here once you sign a day that has one.
              </p>
            ) : (
              <>
                <p className="claims-total">{data.dayworks.totalHours} T&amp;M hours recorded</p>
                <div className="claims-tablewrap">
                  <table className="claims-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entry</th>
                        <th>Description</th>
                        <th>Docket</th>
                        <th className="n">Hours</th>
                        <th>Labour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dayworks.rows.map((row, index) => (
                        <tr key={index}>
                          <td className="mono">{row.date}</td>
                          <td>
                            <Cite entryNo={row.entry_no} />
                          </td>
                          <td>{row.description}</td>
                          <td className={row.docket_ref ? 'mono' : 'claims-flag'}>
                            {row.docket_ref ?? 'NO DOCKET'}
                          </td>
                          <td className="n mono">{row.hours ?? '—'}</td>
                          <td>{row.labour ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <hr className="rule" />
      <Link className="button button--quiet" href={`/?project=${current.project_id}`}>
        Back to today
      </Link>
    </main>
  );
}
