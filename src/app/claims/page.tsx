import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DraftClaimButton } from './draft-button';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { canSee, canManageRegisters } from '@/lib/roles';
import { loadClaimsData, type ClaimsData } from '@/lib/claims/load';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { RegisterSection } from './register-section';
import { AddDocketButton } from './daywork-docket';

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
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }
  if (!canSee(current.role, 'claims')) redirect(`/?project=${current.project_id}`);

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
        Every delay, variation and daywork across the whole job, each line traced to the day it came from.
      </p>

      {data && (
        <div className="claims-summary" aria-label="At a glance">
          <div className="claims-tile">
            <span className="label">Time lost</span>
            <strong>{data.delays.totalHours}h</strong>
            <span>{data.delays.rows.length} event{data.delays.rows.length === 1 ? '' : 's'}{data.delays.manHoursLost ? ` · ${data.delays.manHoursLost} man-hours` : ''}</span>
          </div>
          <div className={`claims-tile${data.variations.summary.notSubmitted.count > 0 ? ' claims-tile--amber' : ''}`}>
            <span className="label">Variations</span>
            <strong>{data.variations.register.length}</strong>
            <span>{data.variations.summary.notSubmitted.count === 0 ? 'all submitted' : `${data.variations.summary.notSubmitted.count} not yet submitted · ${money(data.variations.summary.notSubmitted.value)}`}</span>
          </div>
          <div className={`claims-tile${data.dayworks.missingDockets > 0 ? ' claims-tile--amber' : ''}`}>
            <span className="label">Dayworks</span>
            <strong>{data.dayworks.totalHours}h</strong>
            <span>{data.dayworks.rows.length} item{data.dayworks.rows.length === 1 ? '' : 's'}{data.dayworks.missingDockets > 0 ? ` · ${data.dayworks.missingDockets} without a docket` : ' · all docketed'}</span>
          </div>
        </div>
      )}

      <div className="claims-actions">
        <DraftClaimButton projectId={current.project_id} />
        <a className="button button--quiet" href={`/api/reports/claims?project=${current.project_id}`} download>
          Download as a spreadsheet
        </a>
      </div>
      <hr className="rule" />

      {loadError && <p className="notice gap">{loadError}</p>}

      {data && (
        <>
          <section>
            <div className="claims-head">
              <div>
                <p className="label">Standdown and disruption</p>
                <h2>Time lost</h2>
              </div>
              <span className="claims-count mono">{data.delays.rows.length} event{data.delays.rows.length === 1 ? '' : 's'}</span>
            </div>
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
                          <td className="mono">{fmtDate(row.date)}</td>
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

          <RegisterSection data={data} userId={userId} canManage={canManageRegisters(current.role)} />

          <hr className="rule" />

          <section>
            <div className="claims-head">
              <div>
                <p className="label">Time and materials</p>
                <h2>Dayworks</h2>
              </div>
              <span className="claims-count mono">
                {data.dayworks.rows.length}
                {data.dayworks.missingDockets > 0 && <span className="claims-flag"> · {data.dayworks.missingDockets} without a docket</span>}
              </span>
            </div>
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
                          <td className="mono">{fmtDate(row.date)}</td>
                          <td>
                            <Cite entryNo={row.entry_no} />
                          </td>
                          <td>{row.description}</td>
                          <td className={row.docket_ref || row.docket_added ? 'mono' : 'claims-flag'}>
                            {row.docket_ref
                              ? row.docket_ref
                              : row.docket_added
                                ? <>{row.docket_added.ref}<span className="vr-note">added {fmtDate(row.docket_added.on)}</span></>
                                : 'To chase'}
                            {!row.docket_ref && row.daywork_id && canManageRegisters(current.role) && (
                              <span className="vr-note"><AddDocketButton dayworkId={row.daywork_id} current={row.docket_added?.ref ?? null} /></span>
                            )}
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
        Home
      </Link>
    </main>
  );
}
