'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/brand-mark';
import { SignaturePad } from '@/components/signature-pad';
import { parseTalkSummary } from '@/lib/toolbox/summary';
import { fmtDate } from '@/lib/pdf/dates';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { OutboxStatus } from '@/components/outbox-status';

/**
 * The talk itself. While open: the phone goes around the crew — name, sign,
 * next. Complete freezes it (database-enforced) and unlocks the PDF.
 */
export function TalkScreen({
  talk,
  attendees,
  canRun,
  projectName,
}: {
  talk: {
    id: string;
    projectId: string;
    date: string;
    topic: string;
    summary: string;
    presenter: string;
    completed: boolean;
  };
  attendees: Array<{ id: string; attendee_name: string; signature_path: string }>;
  canRun: boolean;
  projectName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Array<{ id: string; name: string; previewUrl: string | null }>>([]);
  const [pendingFinish, setPendingFinish] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const items = await outbox.forSubject(talk.id);
      if (cancelled) return;
      setPending(items.filter((i) => i.kind === 'talk_attendee').map((i) => ({ id: i.id, name: String(i.payload.name), previewUrl: i.blobs?.signature ? URL.createObjectURL(i.blobs.signature) : null })));
      const fin = items.find((i) => i.kind === 'talk_finish');
      setPendingFinish(fin ? String(fin.payload.at) : null);
    };
    void load();
    const stop = outbox.onOutboxChange(() => void load());
    return () => { cancelled = true; stop(); };
  }, [talk.id]);
  const isDone = talk.completed || pendingFinish !== null;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Editing an open talk: the topic gets tailored to the day right up until
  // the crew sign onto it. Once completed the database refuses the update,
  // so the button goes away with it.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    topic: talk.topic,
    summary: talk.summary,
    presenter: talk.presenter,
    date: talk.date,
  });

  useEffect(() => {
    if (attendees.length === 0) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('entry-photos')
        .createSignedUrls(attendees.map((a) => a.signature_path), 3600);
      if (!cancelled) {
        const next: Record<string, string> = {};
        for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
        setUrls(next);
      }
    })();
    return () => { cancelled = true; };
  }, [attendees]);

  async function addAttendee(blob: Blob) {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name first, then sign.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const attendeeId = outbox.newId();
      const path = `${talk.projectId}/toolbox/${talk.id}/sig-${attendeeId}.png`;
      const live = async () => {
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from('entry-photos')
          .upload(path, blob, { contentType: 'image/png', upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        const { error: insertError } = await supabase
          .from('toolbox_attendees')
          .insert({ id: attendeeId, talk_id: talk.id, attendee_name: trimmed, signature_path: path });
        if (insertError) throw new Error(insertError.message);
      };
      const queue = () => outbox.enqueue({ kind: 'talk_attendee', projectId: talk.projectId, subjectId: talk.id, payload: { attendeeId, name: trimmed, path }, blobs: { signature: blob } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setName('');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-on did not save.');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdits() {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('toolbox_talks')
        .update({
          topic: draft.topic.trim(),
          summary: draft.summary.trim(),
          presenter_name: draft.presenter.trim(),
          talk_date: draft.date,
        })
        .eq('id', talk.id);
      if (updateError) throw new Error(updateError.message);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those changes did not save.');
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    setCompleting(true);
    setError(null);
    try {
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: updateError } = await supabase
          .from('toolbox_talks')
          .update({ completed_at: at, completed_on_device_at: at })
          .eq('id', talk.id);
        if (updateError) throw new Error(updateError.message);
      };
      const queue = () => outbox.enqueue({ kind: 'talk_finish', projectId: talk.projectId, subjectId: talk.id, payload: { at } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the talk.');
    } finally {
      setCompleting(false);
    }
  }

  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/toolbox/${talk.id}/pdf`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        setError(json?.error?.message ?? 'The PDF could not be generated.');
        return;
      }
      window.open(json.url as string, '_blank', 'noopener');
    } catch {
      setError('No signal — try again when you are back in range.');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {projectName}
      </p>
      <h1 className="page-title">{talk.topic}</h1>
      <p className="mono page-subtitle">
        {fmtDate(talk.date)} · presented by {talk.presenter}
      </p>
      <OutboxStatus />
      <p className={isDone ? 'talkstate talkstate--done' : 'talkstate talkstate--open'}>
        {talk.completed
          ? 'Done and signed. This talk is locked and cannot be changed.'
          : pendingFinish
            ? `Completed on this phone at ${new Date(pendingFinish).toTimeString().slice(0, 5)} — it sends when you are back in range, and locks then.`
            : 'Not run yet. Read it out, get the crew to sign, then finish it.'}
      </p>
      <hr className="rule" />

      {editing ? (
        <>
          <label className="fieldcell">
            <span className="label">Date</span>
            <input className="field field--sm" type="date" value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Topic</span>
            <input className="field" value={draft.topic}
              onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">What was covered</span>
            <textarea className="field" rows={16} value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Presented by</span>
            <input className="field field--sm" value={draft.presenter}
              onChange={(e) => setDraft({ ...draft, presenter: e.target.value })} />
          </label>
          <div className="photo-add-pair">
            <button className="button" type="button" onClick={saveEdits}
              disabled={saving || !draft.topic.trim() || !draft.summary.trim() || !draft.presenter.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="button button--quiet" type="button" style={{ marginTop: 0 }}
              disabled={saving}
              onClick={() => {
                setDraft({ topic: talk.topic, summary: talk.summary, presenter: talk.presenter, date: talk.date });
                setEditing(false);
              }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="review-section-head talkread-head">
            <div>
              <p className="label">Read this out</p>
              <h2 className="home-card__title">What to cover</h2>
            </div>
            {!isDone && canRun && (
              <button className="button button--quiet review-add" type="button"
                onClick={() => setEditing(true)}>
                Edit talk
              </button>
            )}
          </div>
          {/*
            Laid out, not dumped. This is the screen the supervisor reads the
            talk off, so headings and points have to look like headings and
            points — the PDF renders the same blocks from the same parser.
          */}
          <div className="talkread">
            {parseTalkSummary(talk.summary).map((block, i) =>
              block.kind === 'heading' ? (
                <p key={i} className="talkread__head">{block.text}</p>
              ) : block.kind === 'points' ? (
                <ul key={i} className="talkread__points">
                  {block.items.map((item, j) => <li key={j}>{item}</li>)}
                </ul>
              ) : (
                <p key={i} className="talkread__para">{block.text}</p>
              ),
            )}
          </div>
        </>
      )}

      <hr className="rule" />
      {!editing && (
        <>
          <p className="label">Who was there</p>
          <h2 className="home-card__title">
            {attendees.length + pending.length === 0
              ? 'Nobody has signed on yet'
              : `${attendees.length + pending.length} signed on`}
          </h2>
          {!isDone && attendees.length + pending.length === 0 && canRun && (
            <p className="way-hint">
              Read the talk out, then hand the phone around. Each person types their
              name and signs with a finger.
            </p>
          )}
        </>
      )}
      {!editing && pending.map((a) => (
        <div key={a.id} className="talk-attendee">
          {a.previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={a.previewUrl} alt="" />
          ) : (
            <span className="talk-attendee__pending" />
          )}
          <span>{a.name}<span className="pending-tag">waiting for signal</span></span>
        </div>
      ))}
      {!editing && attendees.map((a) => (
        <div key={a.id} className="talk-attendee">
          {urls[a.signature_path] ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={urls[a.signature_path]} alt="" />
          ) : (
            <span className="talk-attendee__pending" />
          )}
          <span>{a.attendee_name}</span>
        </div>
      ))}

      {!isDone && canRun && !editing && (
        <div className="sigslot item" style={{ marginTop: '1rem' }}>
          <p className="label">Hand them the phone</p>
          <label className="fieldcell">
            <span className="label">Name</span>
            <input className="field field--sm" value={name} placeholder="Kel Brady"
              onChange={(e) => setName(e.target.value)} />
          </label>
          <SignaturePad saving={saving} onSave={addAttendee} />
        </div>
      )}

      {error && <p className="alert">{error}</p>}

      {!isDone && canRun && !editing && (
        <>
          <button className="button" type="button" disabled={completing || attendees.length + pending.length === 0} onClick={complete}>
            {completing ? 'Finishing…' : 'Finish the talk'}
          </button>
          <p className="way-hint">
            {attendees.length === 0
              ? 'You need at least one signature before you can finish.'
              : `Locks it with ${attendees.length === 1 ? 'the one signature' : `all ${attendees.length} signatures`}. After this the talk cannot be changed — that is what makes it a record.`}
          </p>
        </>
      )}
      {talk.completed && (
        <>
          <button className="button" type="button" disabled={pdfBusy} onClick={downloadPdf}>
            {pdfBusy ? 'Making the PDF…' : 'Get the PDF'}
          </button>
          <p className="way-hint">
            One page with the talk, everyone&rsquo;s signature and the Kooboolong logo —
            what you send the principal when they ask for the safety records.
          </p>
        </>
      )}
      <Link className="button button--quiet" href={`/toolbox?project=${talk.projectId}`}>
        All toolbox talks
      </Link>
    </main>
  );
}
