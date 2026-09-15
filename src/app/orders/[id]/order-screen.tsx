'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { fmtDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { KIND_LABEL, orderRef, statusLabel, isFinished, type OrderKind, type OrderStatus } from '@/lib/orders/model';

export interface OrderView {
  id: string; projectId: string; seq: number; kind: OrderKind; status: OrderStatus; item: string; quantity: string | null; plant: string | null;
  needed_by: string | null; urgent: boolean; notes: string | null; photo_urls: string[]; raised_by: string; raised_by_name: string; raised_on_device_at: string;
  ordered_at: string | null; supplier: string | null; order_ref: string | null; done_at: string | null; done_note: string | null;
  cancelled_at: string | null; cancel_reason: string | null; notified_at: string | null;
  updates: Array<{ id: string; body: string; created_at: string; by: string }>;
}

interface Props { order: OrderView; canProgress: boolean; userId: string; today: string }

/**
 * One request: what was asked for, where it is up to, and the buttons that
 * move it. Status changes save at once and queue without signal; a request
 * someone else has already finished stays finished.
 */
export function OrderScreen({ order: r, canProgress, userId, today }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [supplier, setSupplier] = useState(r.supplier ?? '');
  const [orderRefText, setOrderRefText] = useState(r.order_ref ?? '');
  const [doneNote, setDoneNote] = useState('');
  const [reason, setReason] = useState('');
  const finished = isFinished(r.status);
  const isIssue = r.kind === 'plant_issue';
  const late = !finished && r.needed_by != null && r.needed_by < today;

  useEffect(() => {
    if (r.photo_urls.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('entry-photos').createSignedUrls(r.photo_urls, 3600);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [r.photo_urls]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }

  /** A status change: live when there is signal, queued when there is not. */
  const move = (patch: Record<string, unknown>, label: string) => run(label, async () => {
    const live = async () => {
      const { data, error: e } = await createClient().from('orders').update(patch).eq('id', r.id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('Not allowed from this account.');
    };
    const queue = () => outbox.enqueue({ kind: 'order_status', projectId: r.projectId, subjectId: r.id, payload: { patch, at: new Date().toISOString() } }).then(() => undefined);
    await runOrQueue(live, queue);
  });
  const addUpdate = () => run('add the update', async () => {
    if (!note.trim()) throw new Error('Write the update first.');
    const { error: e } = await createClient().from('order_updates').insert({ order_id: r.id, body: note.trim(), created_by: userId });
    if (e) throw new Error(e.message);
    setNote('');
  });
  const notify = () => run('email the office', async () => {
    const res = await fetch(`/api/orders/${r.id}/notify`, { method: 'POST' });
    const body = (await res.json()) as { sent?: boolean; reason?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message ?? 'The email could not be sent.');
    if (!body.sent && body.reason === 'no addresses') throw new Error('This job has no report email addresses yet — add them in Settings.');
  });
  const remove = () => run('remove it', async () => {
    if (!window.confirm('Remove this request? It has not been ordered, so nothing else refers to it.')) return;
    const { data, error: e } = await createClient().from('orders').delete().eq('id', r.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Only the person who raised it can remove it, and only while it is still open.');
    router.push(`/orders?project=${r.projectId}`);
  });

  return (
    <section className="incident order">
      <p className="label">{orderRef(r.seq)} · {KIND_LABEL[r.kind]}{r.urgent && !finished ? ' · URGENT' : ''}</p>
      <h1 className="page-title">{r.item}</h1>
      <p className={`page-subtitle ${finished ? '' : 'swms__status--active'}`}>
        {statusLabel(r.kind, r.status)}
        {r.status === 'ordered' && r.ordered_at ? ` · ${fmtDate(r.ordered_at.slice(0, 10))}` : ''}
        {r.done_at ? ` · ${fmtDate(r.done_at.slice(0, 10))}` : ''}{r.cancelled_at ? ` · ${fmtDate(r.cancelled_at.slice(0, 10))}` : ''}
        {late ? ' · LATE' : ''}
        {r.urgent && r.notified_at ? ' · office emailed' : ''}
      </p>
      {r.urgent && !r.notified_at && !finished && (
        <p className="notice gap">
          Urgent, and the office has not been emailed yet.
          {canProgress && <> <button type="button" className="linklike" disabled={busy != null} onClick={() => void notify()}>Email the office now</button></>}
        </p>
      )}

      <div className="item">
        <p className="label">What was asked for</p>
        <p className="incident__meta">Raised by {r.raised_by_name} · {fmtDate(r.raised_on_device_at.slice(0, 10))} {awstClock(r.raised_on_device_at)}</p>
        {r.quantity && <p><span className="label">How much</span> {r.quantity}</p>}
        {r.plant && <p><span className="label">Machine</span> {r.plant}</p>}
        {r.needed_by && <p><span className="label">Needed by</span> {fmtDate(r.needed_by)}{late ? ' — late' : ''}</p>}
        {r.notes && <p className="incident__text">{r.notes}</p>}
        {r.photo_urls.length > 0 && (
          <div className="photos__grid report-form__photos">
            {r.photo_urls.map((p) => (
              <figure key={p}>
                {urls[p] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <a href={urls[p]} target="_blank" rel="noopener"><img src={urls[p]} alt="" /></a>
                ) : <span className="talk-attendee__pending" />}
              </figure>
            ))}
          </div>
        )}
      </div>

      {(r.supplier || r.order_ref || r.done_note || r.cancel_reason) && (
        <div className="item">
          <p className="label">Where it is up to</p>
          {r.supplier && <p><span className="label">Supplier</span> {r.supplier}</p>}
          {r.order_ref && <p><span className="label">Order reference</span> {r.order_ref}</p>}
          {r.done_note && <p><span className="label">{isIssue ? 'Fixed' : 'Received'}</span> {r.done_note}</p>}
          {r.cancel_reason && <p><span className="label">Cancelled</span> {r.cancel_reason}</p>}
        </div>
      )}

      <div className="item">
        <p className="label">Updates</p>
        {r.updates.length === 0 && <p className="nil">Nothing added yet.</p>}
        {r.updates.map((u) => (
          <div key={u.id} className="incident__update">
            <p className="caption">{u.by} · {fmtDate(u.created_at.slice(0, 10))} {awstClock(u.created_at)}</p>
            <p className="incident__text">{u.body}</p>
          </div>
        ))}
        {canProgress && !finished && (
          <div className="incident__add">
            <textarea className="field field--sm" rows={2} value={note} placeholder="Rang the supplier, delivery Thursday…" onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="button button--quiet" disabled={busy != null || !note.trim()} onClick={() => void addUpdate()}>Add the update</button>
          </div>
        )}
      </div>

      {error && <p className="alert" role="alert">{error}</p>}
      {canProgress && !finished && (
        <div className="item">
          <p className="label">Move it along</p>
          {r.status === 'open' && !isIssue && (
            <>
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">Supplier</span>
                  <input className="field field--sm" value={supplier} placeholder="Optional" onChange={(e) => setSupplier(e.target.value)} /></label>
                <label className="fieldcell"><span className="label">Order reference</span>
                  <input className="field field--sm" value={orderRefText} placeholder="PO or docket, optional" onChange={(e) => setOrderRefText(e.target.value)} /></label>
              </div>
              <button type="button" className="button" disabled={busy != null} onClick={() => void move({ status: 'ordered', supplier: supplier.trim() || null, order_ref: orderRefText.trim() || null }, 'mark it ordered')}>Mark ordered</button>
            </>
          )}
          {r.status === 'open' && isIssue && (
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void move({ status: 'ordered', supplier: supplier.trim() || null }, 'book it in')}>Booked in for repair</button>
          )}
          <div className="signin__grid" style={{ marginTop: '0.75rem' }}>
            <input className="field field--sm" value={doneNote} placeholder={isIssue ? 'How it was fixed, optional' : 'Where it was delivered, optional'} onChange={(e) => setDoneNote(e.target.value)} />
            <button type="button" className="button" style={{ marginTop: 0, width: 'auto' }} disabled={busy != null} onClick={() => void move({ status: 'done', done_note: doneNote.trim() || null }, isIssue ? 'mark it fixed' : 'mark it received')}>{isIssue ? 'Fixed' : 'Received'}</button>
          </div>
          {r.status === 'ordered' && (
            <button type="button" className="linklike" disabled={busy != null} onClick={() => void move({ status: 'open' }, 'put it back')}>Back to {isIssue ? 'reported' : 'to order'}</button>
          )}
          <div className="signin__grid" style={{ marginTop: '0.75rem' }}>
            <input className="field field--sm" value={reason} placeholder="Why it is cancelled" onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="button button--quiet" style={{ marginTop: 0, width: 'auto' }} disabled={busy != null || !reason.trim()} onClick={() => void move({ status: 'cancelled', cancel_reason: reason.trim() }, 'cancel it')}>Cancel</button>
          </div>
          {r.status === 'open' && r.raised_by === userId && (
            <p className="caption" style={{ marginTop: '0.75rem' }}>Raised by mistake? <button type="button" className="linklike" disabled={busy != null} onClick={() => void remove()}>Remove it</button></p>
          )}
        </div>
      )}
    </section>
  );
}
