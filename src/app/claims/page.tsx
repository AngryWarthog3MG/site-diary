import Link from 'next/link';
import { DraftClaimButton } from './draft-button';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { loadClaimsData, type ClaimsData } from '@/lib/claims/load';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { VariationStatusControl } from './variation-status';
import { STATUS_LABEL, itemValue } from '@/lib/claims/register';

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

          <section>
            <p className="label">
              Variations · {data.variations.register.length}
              {data.variations.unreferenced > 0 && (
                <span className="claims-flag">
                  {' '}
                  {data.variations.unreferenced} diary mention{data.variations.unreferenced === 1 ? '' : 's'} without a VR reference
                </span>
              )}
            </p>
            {data.variations.register.length === 0 ? (
              <p className="claims-nil">
                Nothing yet. Variations turn up here once you sign a day that has one, and then
                you track each one from raised to paid.
              </p>
            ) : (
              <>
                {/*
                  The register at a glance: what has not been asked for yet is
                  where money goes missing, so it leads.
                */}
                <p className="claims-total">
                  {data.variations.summary.notSubmitted.count === 0
                    ? 'Every variation has been submitted.'
                    : `${data.variations.summary.notSubmitted.count} not yet submitted, worth ${money(data.variations.summary.notSubmitted.value)}.`}
                  {data.variations.summary.approvedUnpaid.count > 0 &&
                    ` ${data.variations.summary.approvedUnpaid.count} approved and unpaid, ${money(data.variations.summary.approvedUnpaid.value)}.`}
                </p>
                <p className="vr-summary mono">
                  {data.variations.summary.byStatus
                    .filter((b) => b.count > 0)
                    .map((b) => `${STATUS_LABEL[b.status]} ${b.count}`)
                    .join(' · ')}
                </p>
                {/* Cards, not a wide table: this is read on a phone at the
                    end of the day as often as at a desk. */}
                <ul className="vr-list">
                  {data.variations.register.map((item) => (
                    <li key={item.id} className={`vr-card vr-card--${item.status}`}>
                      <div className="vr-card__head">
                        <span className={item.vr_ref ? 'mono vr-card__ref' : 'claims-flag'}>{item.vr_ref ?? 'NO VR REF'}</span>
                        <span className="mono vr-card__value">
                          {money(itemValue(item))}
                          {item.agreed_cost == null && item.estimated_cost != null && <span className="vr-note"> est.</span>}
                        </span>
                      </div>
                      <p className="vr-card__title">{item.title}</p>
                      <p className="vr-card__meta">
                        Raised {fmtDate(item.raised_on)} ·{' '}
                        {item.mentions.map((m, i) => (
                          <span key={m.entry_no + i}>
                            {i > 0 && ', '}
                            <Cite entryNo={m.entry_no} />
                          </span>
                        ))}
                        {item.status === 'submitted' && item.submitted_on && ` · submitted ${fmtDate(item.submitted_on)}`}
                        {(item.status === 'approved' || item.status === 'rejected') && item.decided_on && ` · decided ${fmtDate(item.decided_on)}`}
                        {item.status === 'paid' && item.paid_on && ` · paid ${fmtDate(item.paid_on)}`}
                      </p>
                      {item.notes && <p className="vr-card__notes">{item.notes}</p>}
                      <VariationStatusControl
                        registerId={item.id}
                        status={item.status}
                        vrRef={item.vr_ref}
                        agreedCost={item.agreed_cost}
                        notes={item.notes}
                      />
                    </li>
                  ))}
                </ul>
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
                          <td className="mono">{fmtDate(row.date)}</td>
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
