import Link from 'next/link';
import type { ClaimsData } from '@/lib/claims/load';
import { fmtDate } from '@/lib/pdf/dates';
import { STATUS_LABEL, itemValue, registerNumber } from '@/lib/claims/register';
import { RecordOnDay, RemoveVariationButton, VariationStatusControl } from './variation-status';

/**
 * The variation register as a section: one card per item, its status control,
 * and the money not yet asked for up top. Drawn on the Claims screen and on
 * its own Variations screen from the same data.
 */
export function RegisterSection({ data, userId, canManage }: { data: ClaimsData; userId: string; canManage: boolean }) {
  const entryLink = (entryNo: string) => {
    const id = data.entryIds[entryNo];
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
  // A signed mention cites its serial; a draft cites the day and opens the review.
  const Mention = ({ m }: { m: { date: string; entry_no: string | null; entry_id: string; signed: boolean } }) =>
    m.signed && m.entry_no ? (
      <Cite entryNo={m.entry_no} />
    ) : (
      <Link className="mono claims-cite claims-cite--draft" href={`/entries/${m.entry_id}/review`}>
        {fmtDate(m.date)} draft
      </Link>
    );

  return (
    <section>
      <div className="claims-head">
        <div>
          <p className="label">Raised to paid</p>
          <h2>Variations</h2>
        </div>
        <span className="claims-count mono">
          {data.variations.register.length}
          {data.variations.unreferenced > 0 && (
            <span className="claims-flag"> · {data.variations.unreferenced} without a client ref</span>
          )}
        </span>
      </div>
      {data.variations.register.length === 0 ? (
        <p className="claims-nil">
          Nothing yet. A variation joins this list the moment it is written into a diary,
          signed or not, and gets a number; from there you track it from raised to paid.
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
                  <span className="mono vr-card__ref">
                    {registerNumber(item.seq)}
                    <span className="vr-card__client">{item.vr_ref ? ` · client ref ${item.vr_ref}` : ' · no client ref yet'}</span>
                    {!item.signed && <span className="vr-tag vr-tag--unsigned">Not yet signed</span>}
                  </span>
                  <span className={`mono vr-card__value${itemValue(item) == null ? ' vr-card__value--none' : ''}`}>
                    {itemValue(item) == null ? 'no value yet' : money(itemValue(item))}
                    {item.agreed_cost == null && item.estimated_cost != null && <span className="vr-note"> est.</span>}
                  </span>
                </div>
                <p className="vr-card__title">{item.title}</p>
                <p className="vr-card__meta">
                  Raised {fmtDate(item.raised_on)} ·{' '}
                  {item.mentions.length === 0 ? (
                    <span className="claims-flag">no longer in any diary</span>
                  ) : (
                    item.mentions.map((m, i) => (
                      <span key={m.entry_id + i}>
                        {i > 0 && ', '}
                        <Mention m={m} />
                      </span>
                    ))
                  )}
                  {item.status === 'submitted' && item.submitted_on && ` · submitted ${fmtDate(item.submitted_on)}`}
                  {(item.status === 'approved' || item.status === 'rejected') && item.decided_on && ` · decided ${fmtDate(item.decided_on)}`}
                  {item.status === 'paid' && item.paid_on && ` · paid ${fmtDate(item.paid_on)}`}
                </p>
                {item.notes && <p className="vr-card__notes">{item.notes}</p>}
                {canManage ? (
                  <VariationStatusControl
                    registerId={item.id}
                    status={item.status}
                    vrRef={item.vr_ref}
                    agreedCost={item.agreed_cost}
                    notes={item.notes}
                    needsValue={itemValue(item) == null}
                  />
                ) : (
                  <p className="vr-note">{STATUS_LABEL[item.status]}</p>
                )}
                {canManage && (() => {
                  const mentioned = new Set(item.mentions.map((m) => m.entry_id));
                  const days = data.variations.openDays.filter((d) => d.author_id === userId && !mentioned.has(d.entry_id));
                  return days.length > 0 ? (
                    <RecordOnDay registerId={item.id} number={registerNumber(item.seq)} days={days} />
                  ) : null;
                })()}
                {canManage && !item.signed && item.mentions.length === 0 && (
                  <RemoveVariationButton registerId={item.id} number={registerNumber(item.seq)} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
