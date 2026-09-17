'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate } from '@/lib/pdf/dates';
import { headContractorName, swmsReviewStatus, SWMS_REVIEW_LABEL, type SwmsReview, type SwmsReviewKind } from '@/lib/subcontract/model';

const STEP_LABEL: Record<SwmsReviewKind, string> = { submitted: 'Submitted', accepted: 'Accepted', returned: 'Returned for changes' };

/**
 * The SWMS and the head contractor (README R74): sent for their review, and accepted or returned
 * with what to change. Each step is its own dated row, never changed. A revision is a new SWMS,
 * so it goes to them again.
 */
export function SwmsReviewPanel({ swmsId, projectId, status: swmsStatus, contractor, reviews: saved, canWrite, today }: { swmsId: string; projectId: string; status: string; contractor: string | null; reviews: SwmsReview[]; canWrite: boolean; today: string }) {
  const router = useRouter();
  const name = headContractorName(contractor);
  // Steps recorded with no signal count at once, in the order they were made; the replay keeps that order.
  const pending = usePending('swms_review', swmsId).map((q) => ({ ...(q.payload.row as Omit<SwmsReview, 'created_at'>), created_at: `~${q.createdAt}`, queued: true }));
  const reviews: Array<SwmsReview & { queued?: boolean }> = [...saved, ...pending];
  const { status, latest } = swmsReviewStatus(reviews);
  const [adding, setAdding] = useState<SwmsReviewKind | null>(null);
  const [on, setOn] = useState(today);
  const [person, setPerson] = useState('');
  const [ref, setRef] = useState('');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = swmsStatus === 'draft' || swmsStatus === 'active';
  const next: SwmsReviewKind[] = status === 'with_them' ? ['accepted', 'returned'] : status === 'accepted' ? [] : ['submitted'];

  async function save() {
    if (!adding) return;
    setBusy(true); setError(null);
    try {
      const row = { id: outbox.newId(), swms_id: swmsId, kind: adding, happened_on: on, person_name: person.trim() || null, reference: ref.trim() || null, comments: comments.trim() || null };
      const live = async () => {
        const { error: e } = await createClient().from('swms_reviews').insert(row);
        if (e) throw new Error(e.message);
      };
      const queue = () => outbox.enqueue({ kind: 'swms_review', projectId, subjectId: swmsId, payload: { row } }).then(() => undefined);
      // A step after one still waiting on the phone must wait behind it, or the database would see "accepted" before "submitted".
      const outcome = pending.length > 0 ? (await queue(), 'queued' as const) : await runOrQueue(live, queue);
      setAdding(null); setPerson(''); setRef(''); setComments('');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`item regpanel${status === 'returned' || (status === 'not_submitted' && swmsStatus === 'active') ? ' item--warn' : ''}`} style={{ margin: '0.9rem 0' }}>
      <p className="label">Review by {name}</p>
      <p className={`caption${status === 'returned' ? ' vr-missing' : ''}`}>
        <strong>{SWMS_REVIEW_LABEL[status]}</strong>{latest ? ` · ${fmtDate(latest.happened_on)}${latest.person_name ? ` · ${latest.person_name}` : ''}` : ''}{pending.length > 0 ? ' · saved on this phone, sends when there is signal' : ''}
        {status === 'returned' && latest?.comments ? ` — ${latest.comments}` : ''}
      </p>
      {reviews.length > 1 && (
        <details className="regpanel__log">
          <summary>Every step</summary>
          <ul className="gaplist">
            {[...reviews].sort((a, b) => a.happened_on.localeCompare(b.happened_on) || a.created_at.localeCompare(b.created_at)).map((r) => (
              <li key={r.id} className="caption">{fmtDate(r.happened_on)} · {STEP_LABEL[r.kind]}{r.person_name ? ` · ${r.person_name}` : ''}{r.reference ? ` · ref ${r.reference}` : ''}{r.comments ? ` — ${r.comments}` : ''}{r.queued ? <strong> · on this phone, not yet sent</strong> : null}</li>
            ))}
          </ul>
        </details>
      )}
      {canWrite && open && !adding && next.map((k) => (
        <button key={k} type="button" className="linklike" style={{ marginRight: '1rem' }} onClick={() => { setAdding(k); setOn(today); }}>
          {k === 'submitted' ? (status === 'returned' ? `Resubmitted to ${name}` : `Submitted to ${name}`) : k === 'accepted' ? `${name} accepted it` : `${name} returned it`}
        </button>
      ))}
      {adding && (
        <div className="regpanel__form">
          {error && <p className="alert" role="alert">{error}</p>}
          <p className="label">{STEP_LABEL[adding]}</p>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">On</span><input id="swr-on" className="field field--sm" type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">{adding === 'submitted' ? 'Sent to' : 'By'}</span><input id="swr-person" className="field field--sm" value={person} onChange={(e) => setPerson(e.target.value)} /></label>
          </div>
          <label className="fieldcell"><span className="label">Reference</span><input id="swr-ref" className="field field--sm" placeholder="Their document or transmittal number" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">{adding === 'returned' ? 'What they want changed' : 'Comments'}</span>
            <textarea id="swr-comments" className="field field--sm" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} /></label>
          <button type="button" className="button" disabled={busy || (adding === 'returned' && !comments.trim())} onClick={() => void save()}>{busy ? 'Saving…' : 'Record it'}</button>
          <button type="button" className="linklike" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
