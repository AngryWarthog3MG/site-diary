'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';

interface Review { id: string; attendees: string; inputs: string; outputs: string; status: 'draft' | 'issued'; issuedOn: string | null; onSchedule: boolean }
interface Action { id: string; action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note?: string | null }

const perthDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * A management review: what was considered, what was decided, and its actions.
 * Actions still open from earlier reviews are shown first and can be closed
 * here, because Spec 201 has them "reviewed at subsequent meetings until
 * closed-out" and ISO puts their status first among a review's inputs.
 */
export function ReviewScreen({ review, actions, carried, canWrite }: { review: Review; actions: Action[]; carried: Array<Action & { fromReview: string }>; canWrite: boolean }) {
  const router = useRouter();
  const draft = review.status === 'draft';
  const [f, setF] = useState({ attendees: review.attendees, inputs: review.inputs, outputs: review.outputs });
  const [na, setNa] = useState({ action: '', owner: '', due: '' });
  const [doneNote, setDoneNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }
  const ro = !draft || !canWrite;

  const actionRow = (x: Action, from?: string) => (
    <div key={x.id} className="item">
      <p style={{ margin: 0 }}>{x.action}</p>
      <p className={`caption${!x.done_at && x.due_on ? ' vr-missing' : ''}`}>
        {from ? `From the review of ${fmtDate(from)} · ` : ''}{x.owner_name ?? 'no owner'}{x.due_on ? ` · due ${fmtDate(x.due_on)}` : ''}
        {x.done_at ? ` · done ${fmtDate(perthDay(x.done_at))}${x.done_note ? ` — ${x.done_note}` : ''}` : ''}
      </p>
      {canWrite && !x.done_at && (draft && !from ? (
        <button type="button" className="linklike" disabled={busy !== null} onClick={() => void act(`del:${x.id}`, async () => {
          const { error: e } = await createClient().from('review_actions').delete().eq('id', x.id);
          if (e) throw new Error(e.message);
        })}>Remove</button>
      ) : (
        <div className="signin__grid" style={{ alignItems: 'end' }}>
          <label className="fieldcell"><span className="label">Done — how</span>
            <input className="field field--sm" id={`ra-${x.id}`} value={doneNote[x.id] ?? ''} onChange={(e) => setDoneNote({ ...doneNote, [x.id]: e.target.value })} /></label>
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act(`done:${x.id}`, async () => {
            const { error: e } = await createClient().from('review_actions').update({ done_at: new Date().toISOString(), done_note: (doneNote[x.id] ?? '').trim() || null }).eq('id', x.id);
            if (e) throw new Error(e.message);
          })}>Mark done</button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="item">
        <p className="label">{draft ? 'Draft' : `Issued ${review.issuedOn ? fmtDate(review.issuedOn) : ''}`}</p>
        {review.onSchedule && <p className="caption">Issuing it marks its schedule done on What&rsquo;s due.</p>}
      </div>

      {carried.length > 0 && (
        <>
          <p className="label" style={{ marginTop: '1rem' }}>Carried forward — actions from earlier reviews still open</p>
          <div className="itp__points">{carried.map((x) => actionRow(x, x.fromReview))}</div>
        </>
      )}

      <label className="fieldcell"><span className="label">Attendees</span>
        <input className="field field--sm" id="rv-att" value={f.attendees} disabled={ro} onChange={(e) => setF({ ...f, attendees: e.target.value })} /></label>
      <label className="fieldcell"><span className="label">What was considered (ISO cl. 9.3.2)</span>
        <textarea className="field field--sm" id="rv-inputs" rows={12} value={f.inputs} disabled={ro} onChange={(e) => setF({ ...f, inputs: e.target.value })} /></label>
      <label className="fieldcell"><span className="label">What was decided (ISO cl. 9.3.3)</span>
        <textarea className="field field--sm" id="rv-outputs" rows={5} value={f.outputs} disabled={ro} onChange={(e) => setF({ ...f, outputs: e.target.value })} /></label>

      <p className="label" style={{ marginTop: '1rem' }}>Actions from this review</p>
      {actions.length === 0 ? <p className="nil">None.</p> : <div className="itp__points">{actions.map((x) => actionRow(x))}</div>}

      {draft && canWrite && (
        <>
          <div className="item" style={{ marginTop: '0.75rem' }}>
            <p className="label">Add an action</p>
            <label className="fieldcell"><span className="label">Action</span>
              <input className="field field--sm" id="na-action" value={na.action} onChange={(e) => setNa({ ...na, action: e.target.value })} /></label>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Owner</span>
                <input className="field field--sm" id="na-owner" value={na.owner} onChange={(e) => setNa({ ...na, owner: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Due</span>
                <input className="field field--sm" id="na-due" type="date" value={na.due} onChange={(e) => setNa({ ...na, due: e.target.value })} /></label>
            </div>
            <button type="button" className="button button--quiet" disabled={busy !== null || !na.action.trim()} onClick={() => void act('action', async () => {
              const { error: e } = await createClient().from('review_actions').insert({ review_id: review.id, action: na.action.trim(), owner_name: na.owner.trim() || null, due_on: na.due || null });
              if (e) throw new Error(e.message);
              setNa({ action: '', owner: '', due: '' });
            })}>Add the action</button>
          </div>
          <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('save', async () => {
              const { error: e } = await createClient().from('management_reviews').update({ attendees: f.attendees.trim(), inputs: f.inputs, outputs: f.outputs }).eq('id', review.id);
              if (e) throw new Error(e.message);
            })}>{busy === 'save' ? 'Saving…' : 'Save the draft'}</button>
            <button type="button" className="button" disabled={busy !== null} onClick={() => void act('issue', async () => {
              const { error: e } = await createClient().from('management_reviews').update({ attendees: f.attendees.trim(), inputs: f.inputs, outputs: f.outputs, status: 'issued' }).eq('id', review.id);
              if (e) throw new Error(e.message);
            })}>{busy === 'issue' ? 'Issuing…' : 'Issue the review'}</button>
          </div>
        </>
      )}
    </>
  );
}
