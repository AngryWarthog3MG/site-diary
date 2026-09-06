import Link from 'next/link';
import type { ClaimsData } from '@/lib/claims/load';
import { fmtDate } from '@/lib/pdf/dates';
import { STATUS_LABEL, itemValue } from '@/lib/claims/register';
import { VariationStatusControl } from './variation-status';

/**
 * The variation register as a section: one card per item, its status control,
 * and the money not yet asked for up top. Drawn on the Claims screen and on
 * its own Variations screen from the same data.
 */
export function RegisterSection({ data }: { data: ClaimsData }) {
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

  return (
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
  );
}
