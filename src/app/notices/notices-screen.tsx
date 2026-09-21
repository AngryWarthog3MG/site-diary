'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { draftFromEvent, draftGaps, hoursSince, noticeRef, sinceText, type NoticeForm } from '@/lib/notices/model';

export interface InboxEvent {
  id: string;
  said_text: string;
  location: string | null;
  directed_by: string | null;
  occurred_time: string | null;
  photos: number;
  entry_id: string;
  entry_no: string | null;
  entry_date: string;
  signed_at: string | null;
}

export interface NoticeRow extends NoticeForm {
  id: string;
  seq: number;
  site_event_id: string | null;
  sent_at: string | null;
  sent_how: string | null;
  sent_to: string | null;
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * Inbox first — every signed event with no notice and no decision — then the
 * drafts with the clock on them, then what has been sent. Nothing here sends
 * anything; "Record as sent" is the person saying they did.
 */
export function NoticesScreen({ projectId, userId, events, notices, dismissed, now }: {
  projectId: string;
  userId: string;
  events: InboxEvent[];
  notices: NoticeRow[];
  dismissed: Record<string, { reason: string; decided_at: string }>;
  now: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const byEvent = new Map(notices.filter((n) => n.site_event_id && !n.voided_at).map((n) => [n.site_event_id as string, n]));
  const inbox = events.filter((e) => !byEvent.has(e.id) && !dismissed[e.id]);
  const eventOf = new Map(events.map((e) => [e.id, e]));
  const drafts = notices.filter((n) => !n.sent_at && !n.voided_at);
  const sent = notices.filter((n) => n.sent_at || n.voided_at);

  async function draftNotice(e: InboxEvent) {
    setBusy(e.id); setError(null);
    try {
      const form = draftFromEvent(e);
      const { error: err } = await createClient().from('notices').insert({ project_id: projectId, site_event_id: e.id, ...form, created_by: userId });
      if (err) throw new Error(err.message);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }

  async function dismiss(e: InboxEvent) {
    if (!reason.trim()) { setError('Say why no notice is needed — it goes on the record.'); return; }
    setBusy(e.id); setError(null);
    try {
      const { error: err } = await createClient().from('site_event_triage').insert({ site_event_id: e.id, project_id: projectId, reason: reason.trim(), decided_by: userId });
      if (err) throw new Error(err.message);
      setDismissing(null); setReason('');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="notices">
      {error && <p className="alert">{error}</p>}

      <section>
        <p className="label">Inbox · {inbox.length}</p>
        {inbox.length === 0 ? (
          <p className="claims-nil">Nothing waiting. Every instruction or event on a signed day has a notice or a decision.</p>
        ) : inbox.map((e) => {
          const hours = hoursSince(e, now);
          return (
            <article key={e.id} className={`item notices__event${hours >= 48 ? ' notices__event--late' : ''}`}>
              <p className="notices__when mono">
                {fmtDate(e.entry_date)}{e.occurred_time ? ` · ${e.occurred_time.slice(0, 5)}` : ''} · <strong>{sinceText(hours)}</strong>
                {e.entry_no ? <> · <Link href={`/entries/${e.entry_id}/signed?project=${projectId}`}>{e.entry_no}</Link></> : null}
              </p>
              <blockquote className="notices__words">{e.said_text}</blockquote>
              <p className="caption">
                {e.directed_by ? `Directed by ${e.directed_by}. ` : ''}{e.location ? `At ${e.location}. ` : ''}{e.photos ? `${e.photos} photo${e.photos === 1 ? '' : 's'} on the day.` : ''}
              </p>
              <div className="claims-actions">
                <button type="button" className="button" disabled={busy === e.id} onClick={() => void draftNotice(e)}>Draft a notice</button>
                <button type="button" className="button button--quiet" disabled={busy === e.id} onClick={() => { setDismissing(dismissing === e.id ? null : e.id); setError(null); }}>No notice needed</button>
              </div>
              {dismissing === e.id && (
                <div className="notices__dismiss">
                  <label className="fieldcell"><span className="label">Why not — on the record</span>
                    <input className="field field--sm" value={reason} placeholder="Within scope — covered by item 4.2" onChange={(ev) => setReason(ev.target.value)} /></label>
                  <button type="button" className="button button--quiet" disabled={busy === e.id} onClick={() => void dismiss(e)}>Record the decision</button>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <hr className="rule" />
      <section>
        <p className="label">Drafts · {drafts.length}</p>
        {drafts.length === 0 ? <p className="caption">No notice is waiting to be sent.</p> : drafts.map((n) => (
          <NoticeCard key={n.id} notice={n} event={n.site_event_id ? eventOf.get(n.site_event_id) ?? null : null} projectId={projectId} now={now} />
        ))}
      </section>

      {sent.length > 0 && (
        <>
          <hr className="rule" />
          <section>
            <p className="label">Sent and voided · {sent.length}</p>
            {sent.map((n) => (
              <article key={n.id} className="item">
                <p className="mono">{noticeRef(n.seq)}{n.reference ? ` · ${n.reference}` : ''} · {n.voided_at ? `voided ${fmtDate(n.voided_at)}` : `sent ${fmtDate(n.sent_at as string)} by ${n.sent_how}${n.sent_to ? ` to ${n.sent_to}` : ''}`}</p>
                <p className="notices__words notices__words--small">{n.what_happened}</p>
                {n.void_reason && <p className="caption">Voided: {n.void_reason}</p>}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

const FIELDS: Array<[keyof NoticeForm, string, string]> = [
  ['what_happened', 'What happened', 'The event, in the words from the diary'],
  ['why_outside_scope', 'Why it is outside our scope', 'Which clause, which drawing, which instruction'],
  ['work_affected', 'The work affected', 'What stopped, slowed or changed, and where'],
  ['what_we_need', 'What we need', 'An instruction, a decision, time, money'],
  ['evidence', 'Evidence', 'Diary days, photos, dockets, emails'],
];

function NoticeCard({ notice, event, projectId, now }: { notice: NoticeRow; event: InboxEvent | null; projectId: string; now: string }) {
  const router = useRouter();
  const [form, setForm] = useState<NoticeForm>({ what_happened: notice.what_happened, why_outside_scope: notice.why_outside_scope, work_affected: notice.work_affected, what_we_need: notice.what_we_need, evidence: notice.evidence });
  const [reference, setReference] = useState(notice.reference ?? '');
  const [sentHow, setSentHow] = useState('email');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hours = event ? hoursSince(event, now) : null;
  const gaps = draftGaps(form);

  async function save() {
    setBusy('save'); setError(null); setSaved(false);
    try {
      const { error: err } = await createClient().from('notices').update({ ...form, reference: reference.trim() || null }).eq('id', notice.id);
      if (err) throw new Error(err.message);
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }

  async function recordSent() {
    if (!sentHow.trim()) { setError('How was it sent?'); return; }
    setBusy('sent'); setError(null);
    try {
      const { error: err } = await createClient().from('notices').update({ ...form, reference: reference.trim() || null, sent_at: new Date().toISOString(), sent_how: sentHow.trim(), sent_to: sentTo.trim() || null }).eq('id', notice.id);
      if (err) throw new Error(err.message);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not record.'); }
    finally { setBusy(null); }
  }

  return (
    <article className={`item notices__draft${hours != null && hours >= 48 ? ' notices__event--late' : ''}`}>
      <p className="mono">
        <strong>{noticeRef(notice.seq)}</strong> · draft
        {hours != null && <> · the event was <strong>{sinceText(hours)}</strong></>}
        {event?.entry_no ? <> · <Link href={`/entries/${event.entry_id}/signed?project=${projectId}`}>{event.entry_no}</Link></> : null}
      </p>
      {FIELDS.map(([key, label, hint]) => (
        <label key={key} className="fieldcell">
          <span className="label">{label}</span>
          <textarea className="field field--sm" rows={key === 'what_happened' ? 4 : 2} value={form[key]} placeholder={hint} onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setSaved(false); }} />
        </label>
      ))}
      <label className="fieldcell"><span className="label">Our reference (optional)</span>
        <input className="field field--sm" value={reference} placeholder="KBL-NOT-007" onChange={(e) => setReference(e.target.value)} /></label>
      {gaps.length > 0 && <p className="caption">Still to write: {gaps.join(', ')}.</p>}
      {error && <p className="alert">{error}</p>}
      {saved && <p className="notice">Saved.</p>}
      <div className="claims-actions">
        <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
      </div>
      <div className="notices__send">
        <p className="caption">Send it yourself — by email, letter, the head contractor’s portal — then record that you did. The app never sends a notice.</p>
        <div className="signin__grid">
          <label className="fieldcell"><span className="label">How</span>
            <input className="field field--sm" value={sentHow} onChange={(e) => setSentHow(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">To</span>
            <input className="field field--sm" value={sentTo} placeholder="Name, or address" onChange={(e) => setSentTo(e.target.value)} /></label>
        </div>
        <button type="button" className="button" disabled={busy != null} onClick={() => void recordSent()}>{busy === 'sent' ? 'Recording…' : 'Record as sent'}</button>
      </div>
    </article>
  );
}
