'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate } from '@/lib/pdf/dates';
import { orderRef } from '@/lib/orders/model';
import { byDay, describe, monthGrid, monthOf, type CalendarItem } from '@/lib/deliveries/model';

interface Job { id: string; code: string; name: string; canBook: boolean }
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLANK = { jobId: '', date: '', item: '', quantity: '', supplier: '', window: '', notes: '', orderId: null as string | null };

/**
 * The deliveries calendar, edited in place (README R127). Booking, moving, receiving and cancelling all go through the
 * outbox: a truck arriving in a dead spot is exactly when the receipt is taken, so a save with no signal is kept on the
 * phone and sent later, and the page is never refreshed on a queued save (README R78).
 */
export function DeliveriesScreen({ items, jobs, month, today, defaultJobId, wholeCompany }: {
  items: CalendarItem[]; jobs: Job[]; month: string; today: string; userId: string; defaultJobId: string; wholeCompany: boolean;
}) {
  const router = useRouter();
  const grid = monthGrid(month);
  const days = byDay(items);
  const [day, setDay] = useState<string>(monthOf(today) === month ? today : `${month}-01`);
  const [booking, setBooking] = useState(false);
  const [form, setForm] = useState({ ...BLANK, jobId: jobs.some((j) => j.id === defaultJobId) ? defaultJobId : (jobs[0]?.id ?? '') });
  const [acting, setActing] = useState<{ id: string; what: 'receive' | 'move' | 'cancel' } | null>(null);
  const [field, setField] = useState({ docket: '', note: '', date: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const queuedBookings = usePending('delivery_book', defaultJobId, 'project');
  const queuedUpdates = usePending('delivery_update', defaultJobId, 'project');

  const jobOf = (id: string) => jobs.find((j) => j.id === id);
  const selected = days.get(day) ?? [];
  const overdue = items.filter((it) => it.tone === 'overdue');
  const canBookAny = jobs.some((j) => j.canBook);

  async function run(fn: () => Promise<{ outcome: 'sent' | 'queued'; text: string }>) {
    setBusy(true); setMsg(null);
    try {
      const { outcome, text } = await fn();
      if (outcome === 'sent') { setMsg({ kind: 'ok', text }); router.refresh(); }
      else setMsg({ kind: 'warn', text: `${text} No signal — kept on this phone and sent when there is.` });
    } catch (e) {
      const m = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? 'That did not save.';
      setMsg({ kind: 'bad', text: /row-level security/i.test(m) ? 'Your role on that job does not book deliveries.' : m });
    } finally { setBusy(false); }
  }

  const book = () => run(async () => {
    const job = jobOf(form.jobId);
    if (!job) throw new Error('Pick the job.');
    if (!form.date) throw new Error('Pick the day it is booked for.');
    if (!form.item.trim()) throw new Error('What is being delivered?');
    const id = outbox.newId();
    const row = {
      id, project_id: job.id, booked_for: form.date, item: form.item.trim(), quantity: form.quantity.trim() || null, supplier: form.supplier.trim() || null,
      window_text: form.window.trim() || null, notes: form.notes.trim() || null, order_id: form.orderId,
    };
    const live = async () => { const { error } = await createClient().from('deliveries').insert(row); if (error) throw error; };
    const queue = () => outbox.enqueue({ kind: 'delivery_book', projectId: job.id, subjectId: id, payload: { row } }).then(() => undefined);
    const outcome = await runOrQueue(live, queue);
    setBooking(false); setForm({ ...BLANK, jobId: form.jobId, date: form.date });
    setDay(form.date);
    return { outcome, text: `${row.item} booked for ${fmtDate(form.date)} on ${job.code}.` };
  });

  const update = (it: CalendarItem, patch: Record<string, unknown>, text: string) => run(async () => {
    const live = async () => {
      const { data, error } = await createClient().from('deliveries').update(patch).eq('id', it.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('That delivery could not be changed from this account, or it is already received or cancelled.');
    };
    const queue = () => outbox.enqueue({ kind: 'delivery_update', projectId: it.projectId, subjectId: it.id, payload: { patch } }).then(() => undefined);
    const outcome = await runOrQueue(live, queue);
    setActing(null); setField({ docket: '', note: '', date: '', reason: '' });
    return { outcome, text };
  });

  const receive = (it: CalendarItem) => update(it, { status: 'received', docket_ref: field.docket.trim() || null, received_note: field.note.trim() || null, received_on_device_at: new Date().toISOString() }, `${it.item} received.`);
  const move = (it: CalendarItem) => {
    if (!field.date) { setMsg({ kind: 'bad', text: 'Pick the new day.' }); return Promise.resolve(); }
    return update(it, { booked_for: field.date, notes: field.note.trim() ? `${it.delivery?.notes ? `${it.delivery.notes}\n` : ''}${field.note.trim()}` : it.delivery?.notes ?? null }, `${it.item} moved to ${fmtDate(field.date)}.`);
  };
  const cancel = (it: CalendarItem) => {
    if (!field.reason.trim()) { setMsg({ kind: 'bad', text: 'Say why it is cancelled.' }); return Promise.resolve(); }
    return update(it, { status: 'cancelled', cancel_reason: field.reason.trim() }, `${it.item} cancelled.`);
  };

  const chipClass = (it: CalendarItem) => `dcal__chip dcal__chip--${it.tone}`;
  const statusText = (it: CalendarItem) => {
    if (it.kind === 'order') return `${it.status === 'ordered' ? 'Ordered' : 'Requested'} · needed by ${fmtDate(it.date)} · no delivery booked`;
    const d = it.delivery!;
    if (d.status === 'received') return `Received ${fmtDate((d.received_on_device_at ?? d.received_at ?? '').slice(0, 10))}${d.received_by_name ? ` by ${d.received_by_name}` : ''}${d.docket_ref ? ` · docket ${d.docket_ref}` : ''}${d.received_note ? ` · ${d.received_note}` : ''}`;
    if (d.status === 'cancelled') return `Cancelled — ${d.cancel_reason}`;
    return `${it.tone === 'overdue' ? 'Overdue — booked for ' : 'Booked for '}${fmtDate(d.booked_for)}${d.window_text ? `, ${d.window_text}` : ''}${d.moved_from.length ? ` · moved from ${d.moved_from.map(fmtDate).join(', ')}` : ''}${d.booked_by_name ? ` · booked by ${d.booked_by_name}` : ''}`;
  };

  const startBooking = (date: string, from?: CalendarItem) => {
    setForm({ ...BLANK, jobId: from?.projectId ?? (jobs.some((j) => j.id === defaultJobId) ? defaultJobId : jobs[0]?.id ?? ''), date, item: from?.item ?? '', quantity: from?.quantity ?? '', supplier: from?.supplier ?? '', orderId: from?.kind === 'order' ? from.id : null });
    setBooking(true); setMsg(null);
  };

  return (
    <section className="dcal">
      {(queuedBookings.length > 0 || queuedUpdates.length > 0) && (
        <p className="notice gap">{queuedBookings.length + queuedUpdates.length} delivery change{queuedBookings.length + queuedUpdates.length === 1 ? '' : 's'} kept on this phone, waiting for signal.</p>
      )}
      {msg && <p className={msg.kind === 'bad' ? 'alert' : msg.kind === 'warn' ? 'notice gap' : 'notice'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>}

      <div className="claims-tablewrap">
        <table className="dcal__grid" aria-label="Deliveries by day">
          <thead><tr>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>
            {grid.map((week) => (
              <tr key={week[0]}>
                {week.map((date) => {
                  const list = days.get(date) ?? [];
                  const out = monthOf(date) !== month;
                  return (
                    <td key={date} className={`dcal__day${out ? ' dcal__day--out' : ''}${date === today ? ' dcal__day--today' : ''}${date === day ? ' dcal__day--on' : ''}`}>
                      <button type="button" className="dcal__pick" onClick={() => { setDay(date); setMsg(null); }} aria-label={`${fmtDate(date)}, ${list.length} item${list.length === 1 ? '' : 's'}`}>
                        <span className="dcal__num">{Number(date.slice(8, 10))}</span>
                        {list.slice(0, 3).map((it) => (
                          <span key={`${it.kind}-${it.id}`} className={chipClass(it)}>{wholeCompany ? `${it.projectCode} · ` : ''}{it.item}</span>
                        ))}
                        {list.length > 3 && <span className="dcal__more">+{list.length - 3} more</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption dcal__key"><span className="dcal__chip dcal__chip--booked">booked</span> <span className="dcal__chip dcal__chip--today">today</span> <span className="dcal__chip dcal__chip--overdue">overdue</span> <span className="dcal__chip dcal__chip--received">received</span> <span className="dcal__chip dcal__chip--cancelled">cancelled</span> <span className="dcal__chip dcal__chip--order">order, no delivery booked</span></p>

      {overdue.length > 0 && (
        <div className="item dcal__overdue">
          <p className="label">Booked for a day gone by, not received · {overdue.length}</p>
          <ul className="plainlist">{overdue.map((it) => <li key={it.id}><button type="button" className="quotebtn" onClick={() => setDay(it.date)}>{fmtDate(it.date)}</button> · {wholeCompany ? `${it.projectCode} · ` : ''}{describe(it)}</li>)}</ul>
        </div>
      )}

      <div className="dcal__detail">
        <div className="review-section-head">
          <div><p className="label">{fmtDate(day)}{day === today ? ' · today' : ''}</p><h2>{selected.length === 0 ? 'Nothing booked' : `${selected.length} on the calendar`}</h2></div>
          {canBookAny && !booking && <button type="button" className="button" onClick={() => startBooking(day)}>Book a delivery</button>}
        </div>

        {booking && (
          <div className="item dcal__form">
            <p className="label">Book a delivery{form.orderId ? ' for an order' : ''}</p>
            <div className="regs__fields">
              {wholeCompany && (
                <label className="fieldcell regs__field"><span className="label">Job</span>
                  <select className="field field--sm" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })}>{jobs.filter((j) => j.canBook).map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}</select></label>
              )}
              <label className="fieldcell regs__field"><span className="label">Day</span><input className="field field--sm" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              <label className="fieldcell regs__field"><span className="label">When in the day · optional</span><input className="field field--sm" placeholder="AM, 7–9, after lunch" value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value })} /></label>
              <label className="fieldcell regs__field regs__field--wide"><span className="label">What</span><input className="field field--sm" placeholder="Plants for PG1" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} /></label>
              <label className="fieldcell regs__field"><span className="label">How much · optional</span><input className="field field--sm" placeholder="400, 20 m3, 2 pallets" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
              <label className="fieldcell regs__field"><span className="label">Supplier · optional</span><input className="field field--sm" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></label>
              <label className="fieldcell regs__field regs__field--wide"><span className="label">Notes · optional</span><input className="field field--sm" placeholder="Gate, contact, what to have ready" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            <div className="regs__actions">
              <button type="button" className="button" disabled={busy} onClick={() => void book()}>{busy ? 'Saving…' : 'Book it'}</button>
              <button type="button" className="quotebtn" disabled={busy} onClick={() => setBooking(false)}>Cancel</button>
            </div>
          </div>
        )}

        {selected.length > 0 && (
          <ul className="plainlist dcal__list">
            {selected.map((it) => {
              const job = jobOf(it.projectId);
              const open = it.kind === 'delivery' && it.status === 'booked' && Boolean(job?.canBook);
              const here = acting?.id === it.id ? acting.what : null;
              return (
                <li key={`${it.kind}-${it.id}`} className={`dcal__row dcal__row--${it.tone}`}>
                  <div className="dcal__row-main">
                    <p className="dcal__row-title">{wholeCompany ? <span className="mono">{it.projectCode} · </span> : null}{describe(it)}</p>
                    <p className="caption">{statusText(it)}{it.delivery?.notes ? ` · ${it.delivery.notes}` : ''}</p>
                    {it.kind === 'order' && <p className="caption"><Link href={`/orders/${it.id}?project=${it.projectId}`}>{orderRef(it.order!.seq)}</Link>{it.order?.urgent ? ' · urgent' : ''}</p>}
                    {it.kind === 'delivery' && it.delivery?.order_id && <p className="caption"><Link href={`/orders/${it.delivery.order_id}?project=${it.projectId}`}>The order it fulfils</Link></p>}
                  </div>
                  <div className="dcal__row-actions">
                    {open && !here && (<>
                      <button type="button" className="quotebtn" disabled={busy} onClick={() => { setActing({ id: it.id, what: 'receive' }); setField({ docket: '', note: '', date: '', reason: '' }); }}>Received</button>
                      <button type="button" className="quotebtn" disabled={busy} onClick={() => { setActing({ id: it.id, what: 'move' }); setField({ docket: '', note: '', date: '', reason: '' }); }}>Move</button>
                      <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => { setActing({ id: it.id, what: 'cancel' }); setField({ docket: '', note: '', date: '', reason: '' }); }}>Cancel</button>
                    </>)}
                    {it.kind === 'order' && job?.canBook && <button type="button" className="quotebtn" disabled={busy} onClick={() => startBooking(it.date, it)}>Book its delivery</button>}
                  </div>
                  {here === 'receive' && (
                    <div className="dcal__act">
                      <label className="fieldcell"><span className="label">Docket number · optional</span><input className="field field--sm" value={field.docket} onChange={(e) => setField({ ...field, docket: e.target.value })} /></label>
                      <label className="fieldcell dcal__grow"><span className="label">Note · optional</span><input className="field field--sm" placeholder="Short, damaged, part-delivery…" value={field.note} onChange={(e) => setField({ ...field, note: e.target.value })} /></label>
                      <button type="button" className="button button--quiet" disabled={busy} onClick={() => void receive(it)}>{busy ? 'Saving…' : 'Mark received'}</button>
                      <button type="button" className="quotebtn" disabled={busy} onClick={() => setActing(null)}>Back</button>
                    </div>
                  )}
                  {here === 'move' && (
                    <div className="dcal__act">
                      <label className="fieldcell"><span className="label">New day</span><input className="field field--sm" type="date" value={field.date} onChange={(e) => setField({ ...field, date: e.target.value })} /></label>
                      <label className="fieldcell dcal__grow"><span className="label">Why · optional</span><input className="field field--sm" placeholder="Supplier pushed it back" value={field.note} onChange={(e) => setField({ ...field, note: e.target.value })} /></label>
                      <button type="button" className="button button--quiet" disabled={busy} onClick={() => void move(it)}>{busy ? 'Saving…' : 'Move it'}</button>
                      <button type="button" className="quotebtn" disabled={busy} onClick={() => setActing(null)}>Back</button>
                    </div>
                  )}
                  {here === 'cancel' && (
                    <div className="dcal__act">
                      <label className="fieldcell dcal__grow"><span className="label">Why is it cancelled?</span><input className="field field--sm" value={field.reason} onChange={(e) => setField({ ...field, reason: e.target.value })} /></label>
                      <button type="button" className="button button--quiet" disabled={busy} onClick={() => void cancel(it)}>{busy ? 'Saving…' : 'Cancel the delivery'}</button>
                      <button type="button" className="quotebtn" disabled={busy} onClick={() => setActing(null)}>Keep it</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
