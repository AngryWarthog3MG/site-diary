'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ClaimsData } from '@/lib/claims/load';
import { fmtDate } from '@/lib/pdf/dates';
import {
  STAGES, STATUS_LABEL, STATUS_HINT, itemValue, registerNumber, stageIndex, stageDates, waitingOn, nextFreeNumber, trackerOrder,
  type RegisterItem, type VariationStatus,
} from '@/lib/claims/register';
import { RecordOnDay, RemoveVariationButton, VariationStatusControl } from '@/app/claims/variation-status';

const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`);
const short = (iso: string | null) => (iso ? fmtDate(iso).slice(0, 5) : '');

/**
 * The register as a tracker. Up top, the pipeline: how many sit at each stage
 * and what they are worth, tap a stage to see only those. Then one card per
 * variation: where it is on the path, with the date each stage was reached;
 * what it is waiting on, in one line; the days, hours and crew behind it. The
 * history and the controls open under the card. Everything a PM asks about a
 * variation, answered without opening a diary.
 */
export function VariationTracker({ data, userId, canManage, today }: { data: ClaimsData; userId: string; canManage: boolean; today: string }) {
  const [stage, setStage] = useState<VariationStatus | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const items = data.variations.register;
  const s = data.variations.summary;
  const byStatus = (st: VariationStatus) => s.byStatus.find((b) => b.status === st) ?? { status: st, count: 0, value: 0 };
  const shown = trackerOrder(stage === 'all' ? items : items.filter((i) => i.status === stage), today);
  const total = items.reduce((n, i) => n + (itemValue(i) ?? 0), 0);
  const withClient = byStatus('submitted');
  const entryLink = (entryNo: string) => (data.entryIds[entryNo] ? `/entries/${data.entryIds[entryNo]}/signed` : null);

  if (items.length === 0) {
    return (
      <p className="claims-nil">
        Nothing yet. A variation joins this tracker the moment it is written into a diary, signed or not, and gets a
        number — the first will be {registerNumber(1)}. From there you move it along as it is priced, sent, decided and paid.
      </p>
    );
  }

  return (
    <section className="vt">
      {/* The pipeline: the path every variation walks, with what sits at each step. */}
      <ol className="vt-pipe" aria-label="Stages">
        {STAGES.map((st, i) => {
          const b = byStatus(st);
          return (
            <li key={st} className={`vt-pipe__step${stage === st ? ' vt-pipe__step--on' : ''}${b.count === 0 ? ' vt-pipe__step--empty' : ''}`}>
              <button type="button" onClick={() => setStage(stage === st ? 'all' : st)} title={STATUS_HINT[st]}>
                <span className="vt-pipe__n mono">{b.count}</span>
                <span className="vt-pipe__name">{STATUS_LABEL[st]}</span>
                <span className="vt-pipe__value mono">{b.count ? money(b.value) : ''}</span>
              </button>
              {i < STAGES.length - 1 && <span className="vt-pipe__arrow" aria-hidden>›</span>}
            </li>
          );
        })}
        {byStatus('rejected').count > 0 && (
          <li className={`vt-pipe__step vt-pipe__step--off${stage === 'rejected' ? ' vt-pipe__step--on' : ''}`}>
            <button type="button" onClick={() => setStage(stage === 'rejected' ? 'all' : 'rejected')} title={STATUS_HINT.rejected}>
              <span className="vt-pipe__n mono">{byStatus('rejected').count}</span>
              <span className="vt-pipe__name">Rejected</span>
              <span className="vt-pipe__value mono">{money(byStatus('rejected').value)}</span>
            </button>
          </li>
        )}
      </ol>

      {/* The money, in the four figures the office asks for. */}
      <div className="vt-money">
        <div><span className="label">All variations</span><strong className="mono">{money(total)}</strong><span className="caption">{items.length} raised</span></div>
        <div className={s.notSubmitted.count > 0 ? 'vt-money--act' : ''}><span className="label">Not yet sent</span><strong className="mono">{money(s.notSubmitted.value)}</strong><span className="caption">{s.notSubmitted.count} to price and send</span></div>
        <div><span className="label">With the client</span><strong className="mono">{money(withClient.value)}</strong><span className="caption">{withClient.count} awaiting a decision</span></div>
        <div className={s.approvedUnpaid.count > 0 ? 'vt-money--act' : ''}><span className="label">Approved, unpaid</span><strong className="mono">{money(s.approvedUnpaid.value)}</strong><span className="caption">{s.approvedUnpaid.count} to invoice</span></div>
      </div>
      <p className="caption vt-free">
        {stage === 'all' ? `${items.length} variation${items.length === 1 ? '' : 's'}, action needed first.` : <>Showing {STATUS_LABEL[stage].toLowerCase()} only · <button type="button" className="linklike" onClick={() => setStage('all')}>show all</button></>}
        {' '}Next number on a day: <strong className="mono">{registerNumber(nextFreeNumber(items))}</strong>.
      </p>

      <ul className="vt-list">
        {shown.map((item) => {
          const w = waitingOn(item, today);
          const dates = stageDates(item);
          const reached = stageIndex(item.status);
          const isOpen = open === item.id;
          const value = itemValue(item);
          return (
            <li key={item.id} id={`vr-${item.seq}`} className={`vt-card vt-card--${w.tone}`}>
              <button type="button" className="vt-card__main" onClick={() => setOpen(isOpen ? null : item.id)} aria-expanded={isOpen}>
                <span className="vt-card__top">
                  <span className="mono vt-card__ref">{registerNumber(item.seq)}{item.vr_ref ? <span className="vt-card__client"> · {item.vr_ref}</span> : null}</span>
                  <span className={`mono vt-card__value${value == null ? ' vt-card__value--none' : ''}`}>{value == null ? 'no value' : money(value)}{item.agreed_cost == null && value != null ? <span className="vt-est"> est.</span> : null}</span>
                </span>
                <span className="vt-card__title">{item.title}</span>
                <span className={`vt-wait vt-wait--${w.tone}`}>{w.text}</span>
                <span className="vt-track" aria-label="Where it is">
                  {STAGES.map((st, i) => {
                    const state = item.status === 'rejected' ? (i < 2 ? 'done' : i === 2 ? 'stop' : 'todo') : i < reached ? 'done' : i === reached ? 'here' : 'todo';
                    const date = item.status === 'rejected' && i === 2 ? dates.rejected : dates[st];
                    return (
                      <span key={st} className={`vt-track__step vt-track__step--${state}`}>
                        <span className="vt-track__dot" />
                        <span className="vt-track__name">{item.status === 'rejected' && i === 2 ? 'Rejected' : STATUS_LABEL[st]}</span>
                        <span className="vt-track__date mono">{date ? short(date) : ''}</span>
                      </span>
                    );
                  })}
                </span>
                <span className="vt-card__facts caption">
                  {item.mentions.length} day{item.mentions.length === 1 ? '' : 's'} · {item.hours > 0 ? `${item.hours} h` : 'no hours stated'}
                  {item.crew.length > 0 ? ` · ${item.crew.join(', ')}` : ''}
                  {!item.signed ? ' · not yet signed' : ''}
                </span>
              </button>

              {isOpen && (
                <div className="vt-card__body">
                  <p className="label">The days behind it</p>
                  {item.mentions.length === 0 ? <p className="nil">No diary day records it any more.</p> : (
                    <table className="vt-days">
                      <thead><tr><th>Day</th><th>Diary</th><th className="n">Hours</th><th>Who</th><th>What was directed</th></tr></thead>
                      <tbody>
                        {item.mentions.map((m) => (
                          <tr key={m.entry_id + m.date}>
                            <td className="mono">{fmtDate(m.date)}</td>
                            <td>
                              {m.signed && m.entry_no ? (entryLink(m.entry_no) ? <Link className="mono claims-cite" href={entryLink(m.entry_no)!}>{m.entry_no}</Link> : <span className="mono">{m.entry_no}</span>)
                                : <Link className="mono claims-cite claims-cite--draft" href={`/entries/${m.entry_id}/review`}>draft</Link>}
                            </td>
                            <td className="n mono">{m.hours == null ? '—' : m.hours}</td>
                            <td>{m.crew.length ? m.crew.join(', ') : '—'}</td>
                            <td>{m.description ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {item.notes && <p className="vt-notes"><span className="label">Notes</span> {item.notes}</p>}

                  <p className="label" style={{ marginTop: '0.9rem' }}>History</p>
                  <ol className="vt-history">
                    <li><span className="mono">{fmtDate(item.raised_on)}</span> Raised — first recorded in the diary</li>
                    {item.events.map((e, i) => (
                      <li key={i}><span className="mono">{fmtDate(e.at.slice(0, 10))}</span> {STATUS_LABEL[e.status]}{e.by ? ` — ${e.by}` : ''}{e.note ? <em> “{e.note}”</em> : null}</li>
                    ))}
                    {item.events.length === 0 && <li className="caption">No moves yet.</li>}
                  </ol>

                  {canManage ? (
                    <div className="vt-controls">
                      <p className="label">Move it along</p>
                      <VariationStatusControl registerId={item.id} status={item.status} vrRef={item.vr_ref} agreedCost={item.agreed_cost} notes={item.notes} needsValue={value == null} />
                      {(() => {
                        const mentioned = new Set(item.mentions.map((m) => m.entry_id));
                        const days = data.variations.openDays.filter((d) => d.author_id === userId && !mentioned.has(d.entry_id));
                        return days.length > 0 ? <RecordOnDay registerId={item.id} number={registerNumber(item.seq)} days={days} /> : null;
                      })()}
                      {!item.signed && item.mentions.length === 0 && <RemoveVariationButton registerId={item.id} number={registerNumber(item.seq)} />}
                    </div>
                  ) : (
                    <p className="vr-note">{STATUS_LABEL[item.status]} — {STATUS_HINT[item.status]}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { RegisterItem };
