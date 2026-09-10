'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/brand-mark';
import { SignaturePad } from '@/components/signature-pad';
import { parseTalkSummary } from '@/lib/toolbox/summary';
import { PRESTART_CHECKS, type ChecklistState } from '@/lib/prestart/checklist';
import { fmtDate } from '@/lib/pdf/dates';
import { PrestartSpecPicker } from '../spec-picker';
import type { SpecNote } from '@/lib/prestart/spec-notes';
import { DictateButton } from '../dictate-button';
import { mergeField, appendDictation, type DictatedFields } from '@/lib/prestart/dictation-merge';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { OutboxStatus } from '@/components/outbox-status';

interface Prestart {
  id: string;
  projectId: string;
  date: string;
  supervisor: string;
  work: string;
  hazards: string;
  plant: string;
  permits: string;
  notes: string;
  /** What was said, if the briefing was talked through. Provenance only. */
  dictation: string | null;
  checklist: ChecklistState;
  specNotes: SpecNote[];
  completed: boolean;
}

interface Attendee {
  id: string;
  attendee_name: string;
  fit_for_work: boolean;
  signature_path: string;
}

function Blocks({ text }: { text: string }) {
  return (
    <div className="talkread">
      {parseTalkSummary(text).map((block, i) =>
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
  );
}

/**
 * The prestart itself. While open: read it out, the phone goes around the
 * crew — name, fit or not, sign, next. Finish freezes it (database-enforced)
 * and unlocks the PDF.
 */
export function PrestartScreen(props: {
  prestart: Prestart;
  attendees: Attendee[];
  crew: string[];
  canRun: boolean;
  projectName: string;
  /** Set when this prestart exists only on the phone so far: it was made with no signal. */
  local?: boolean;
}) {
  const { prestart, attendees, crew, canRun, projectName } = props;
  const router = useRouter();
  // Sign-ons and a finish done with no signal sit in the outbox until they
  // send; the screen shows them as they happened.
  const [pending, setPending] = useState<Array<{ id: string; name: string; fit: boolean; previewUrl: string | null }>>([]);
  const [pendingFinish, setPendingFinish] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const items = await outbox.forSubject(prestart.id);
      if (cancelled) return;
      setPending(items.filter((i) => i.kind === 'prestart_attendee').map((i) => ({
        id: i.id, name: String(i.payload.name), fit: Boolean(i.payload.fit),
        previewUrl: i.blobs?.signature ? URL.createObjectURL(i.blobs.signature) : null,
      })));
      const fin = items.find((i) => i.kind === 'prestart_finish');
      setPendingFinish(fin ? String(fin.payload.at) : null);
    };
    void load();
    const stop = outbox.onOutboxChange(() => void load());
    return () => { cancelled = true; stop(); };
  }, [prestart.id]);
  const isDone = prestart.completed || pendingFinish !== null;
  const signedCount = attendees.length + pending.length;
  const [name, setName] = useState('');
  const [fit, setFit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'briefing' | 'spec' | 'signon'>('briefing');
  const [draft, setDraft] = useState({
    date: prestart.date,
    supervisor: prestart.supervisor,
    work: prestart.work,
    hazards: prestart.hazards,
    plant: prestart.plant,
    permits: prestart.permits,
    notes: prestart.notes,
    checklist: prestart.checklist,
    dictation: prestart.dictation,
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

  const signedNames = new Set(attendees.map((a) => a.attendee_name.toLowerCase()));
  const notFit = attendees.filter((a) => !a.fit_for_work).length;

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
      const path = `${prestart.projectId}/prestart/${prestart.id}/sig-${attendeeId}.png`;
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from('entry-photos')
          .upload(path, blob, { contentType: 'image/png', upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        const { error: insertError } = await supabase
          .from('prestart_attendees')
          .insert({ id: attendeeId, prestart_id: prestart.id, attendee_name: trimmed, fit_for_work: fit, signature_path: path });
        if (insertError) throw new Error(insertError.message);
      };
      const queue = () => outbox.enqueue({
        kind: 'prestart_attendee', projectId: prestart.projectId, subjectId: prestart.id,
        payload: { attendeeId, name: trimmed, fit, path, at }, blobs: { signature: blob },
      }).then(() => undefined);
      const outcome = props.local ? (await queue(), 'queued' as const) : await runOrQueue(live, queue);
      setName('');
      setFit(true);
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
      const changes = {
        prestart_date: draft.date,
        supervisor_name: draft.supervisor.trim(),
        work_planned: draft.work.trim(),
        hazards: draft.hazards.trim(),
        plant: draft.plant.trim() || null,
        permits: draft.permits.trim() || null,
        notes: draft.notes.trim() || null,
        checklist: draft.checklist,
        dictation: draft.dictation,
      };
      const live = async () => {
        const supabase = createClient();
        const { error: updateError } = await supabase.from('prestarts').update(changes).eq('id', prestart.id);
        if (updateError) throw new Error(updateError.message);
      };
      const queue = () => outbox.enqueue({ kind: 'prestart_edit', projectId: prestart.projectId, subjectId: prestart.id, payload: { changes } }).then(() => undefined);
      const outcome = props.local ? (await queue(), 'queued' as const) : await runOrQueue(live, queue);
      setEditing(false);
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those changes did not save.');
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: updateError } = await supabase
          .from('prestarts')
          .update({ completed_at: at, completed_on_device_at: at })
          .eq('id', prestart.id);
        if (updateError) throw new Error(updateError.message);
      };
      const queue = () => outbox.enqueue({ kind: 'prestart_finish', projectId: prestart.projectId, subjectId: prestart.id, payload: { at } }).then(() => undefined);
      const outcome = props.local ? (await queue(), 'queued' as const) : await runOrQueue(live, queue);
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish the prestart.');
    } finally {
      setFinishing(false);
    }
  }

  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prestart/${prestart.id}/pdf`, { method: 'POST' });
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
      <h1 className="page-title">Prestart · {fmtDate(prestart.date)}</h1>
      <p className="mono page-subtitle">Run by {prestart.supervisor}</p>
      <p className={isDone ? 'talkstate talkstate--done' : 'talkstate talkstate--open'}>
        {prestart.completed
          ? 'Finished and signed. This prestart is locked and cannot be changed.'
          : pendingFinish
            ? `Finished on this phone at ${new Date(pendingFinish).toTimeString().slice(0, 5)} — it sends when you are back in range, and locks then.`
            : props.local
              ? 'Kept on this phone until there is signal. Sign the crew on as normal; it all sends together.'
              : 'Not finished. Read it out, get everyone to sign on, then finish it.'}
      </p>
      <OutboxStatus />
      <nav className="review-tabs" aria-label="Prestart sections">
        {([['briefing', 'Briefing', null], ['spec', 'Spec', prestart.specNotes.length], ['signon', 'Sign-on', signedCount]] as const).map(([key, label, count]) => (
          <button key={key} type="button" className={`review-tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>
            {label}
            {count != null && <span className="review-tab__count mono">{count}</span>}
          </button>
        ))}
      </nav>

      {tab === 'briefing' && (editing ? (
        <>
          <div className="photo-add-pair">
            <label className="fieldcell" style={{ flex: 1 }}>
              <span className="label">Date</span>
              <input className="field field--sm" type="date" value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label className="fieldcell" style={{ flex: 1 }}>
              <span className="label">Run by</span>
              <input className="field field--sm" value={draft.supervisor}
                onChange={(e) => setDraft({ ...draft, supervisor: e.target.value })} />
            </label>
          </div>
          <DictateButton projectId={prestart.projectId} disabled={saving} onResult={(fields: DictatedFields, transcript) =>
            setDraft((d) => ({
              ...d,
              work: mergeField(d.work, fields.work_planned),
              hazards: mergeField(d.hazards, fields.hazards),
              plant: mergeField(d.plant, fields.plant),
              permits: mergeField(d.permits, fields.permits),
              notes: mergeField(d.notes, fields.notes),
              dictation: appendDictation(d.dictation, transcript),
            }))} />
          <label className="fieldcell">
            <span className="label">What is on today</span>
            <textarea className="field" rows={4} value={draft.work}
              onChange={(e) => setDraft({ ...draft, work: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Hazards and controls</span>
            <textarea className="field" rows={5} value={draft.hazards}
              onChange={(e) => setDraft({ ...draft, hazards: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Plant on site</span>
            <textarea className="field" rows={2} value={draft.plant}
              onChange={(e) => setDraft({ ...draft, plant: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Permits</span>
            <input className="field" value={draft.permits}
              onChange={(e) => setDraft({ ...draft, permits: e.target.value })} />
          </label>
          <p className="label" style={{ marginTop: '1rem' }}>Checks</p>
          <div className="checklist">
            {PRESTART_CHECKS.map((item) => (
              <label key={item.key} className={`checkrow${draft.checklist[item.key] ? ' checkrow--on' : ''}`}>
                <input type="checkbox" checked={Boolean(draft.checklist[item.key])}
                  onChange={(e) => setDraft({ ...draft, checklist: { ...draft.checklist, [item.key]: e.target.checked } })} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <label className="fieldcell">
            <span className="label">Anything else</span>
            <textarea className="field" rows={2} value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          <div className="photo-add-pair">
            <button className="button" type="button" onClick={saveEdits}
              disabled={saving || !draft.supervisor.trim() || !draft.work.trim() || !draft.hazards.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="button button--quiet" type="button" style={{ marginTop: 0 }} disabled={saving}
              onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="review-section-head talkread-head">
            <div>
              <p className="label">Read this out</p>
              <h2 className="home-card__title">What is on today</h2>
            </div>
            {!prestart.completed && canRun && (
              <button className="button button--quiet review-add" type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>
          <Blocks text={prestart.work} />

          <p className="label" style={{ marginTop: '1.25rem' }}>Hazards and controls</p>
          <Blocks text={prestart.hazards} />

          {prestart.plant && (
            <>
              <p className="label" style={{ marginTop: '1.25rem' }}>Plant on site</p>
              <Blocks text={prestart.plant} />
            </>
          )}
          {prestart.permits && (
            <>
              <p className="label" style={{ marginTop: '1.25rem' }}>Permits</p>
              <Blocks text={prestart.permits} />
            </>
          )}

          <p className="label" style={{ marginTop: '1.25rem' }}>Checks</p>
          <ul className="checkread">
            {PRESTART_CHECKS.map((item) => {
              const yes = Boolean(prestart.checklist[item.key]);
              return (
                <li key={item.key} className={yes ? 'checkread__yes' : 'checkread__no'}>
                  <span className="checkread__mark">{yes ? '✓' : '✗'}</span>
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ul>

          {prestart.notes && (
            <>
              <p className="label" style={{ marginTop: '1.25rem' }}>Anything else</p>
              <Blocks text={prestart.notes} />
            </>
          )}
        </>
      ))}

      {tab === 'spec' && (
        <PrestartSpecPicker
          projectId={prestart.projectId}
          work={prestart.work}
          notes={prestart.specNotes}
          readOnly={prestart.completed || !canRun}
          onKeep={async (notes) => {
            const supabase = createClient();
            const { error: updateError } = await supabase.from('prestarts').update({ spec_notes: notes }).eq('id', prestart.id);
            if (updateError) throw new Error(updateError.message);
            router.refresh();
          }}
        />
      )}

      {tab === 'signon' && (<>
      <hr className="rule" />

      {!editing && (
        <>
          <p className="label">Who is here</p>
          <h2 className="home-card__title">
            {attendees.length === 0 ? 'Nobody has signed on yet' : `${attendees.length} signed on`}
            {notFit > 0 ? ` · ${notFit} not fit for work` : ''}
          </h2>
          {!isDone && signedCount === 0 && canRun && (
            <p className="way-hint">
              Read it out, then hand the phone around. Each person taps or types their name,
              says whether they are fit for work, and signs with a finger.
            </p>
          )}
        </>
      )}

      {!editing && pending.map((a) => (
        <div key={a.id} className={`talk-attendee${a.fit ? '' : ' talk-attendee--notfit'}`}>
          {a.previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={a.previewUrl} alt="" />
          ) : (
            <span className="talk-attendee__pending" />
          )}
          <span>
            {a.name}
            {!a.fit && <strong className="notfit-tag"> · not fit for work</strong>}
            <span className="pending-tag">waiting for signal</span>
          </span>
        </div>
      ))}
      {!editing && attendees.map((a) => (
        <div key={a.id} className={`talk-attendee${a.fit_for_work ? '' : ' talk-attendee--notfit'}`}>
          {urls[a.signature_path] ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={urls[a.signature_path]} alt="" />
          ) : (
            <span className="talk-attendee__pending" />
          )}
          <span>
            {a.attendee_name}
            {!a.fit_for_work && <strong className="notfit-tag"> · not fit for work</strong>}
          </span>
        </div>
      ))}

      {!isDone && canRun && !editing && (
        <div className="sigslot item" style={{ marginTop: '1rem' }}>
          <p className="label">Hand them the phone</p>
          {crew.filter((c) => !signedNames.has(c.toLowerCase())).length > 0 && (
            <div className="crewchips">
              {crew.filter((c) => !signedNames.has(c.toLowerCase())).map((c) => (
                <button key={c} type="button" className={`quotebtn crewchip${name === c ? ' crewchip--on' : ''}`}
                  onClick={() => setName(c)}>
                  + {c}
                </button>
              ))}
            </div>
          )}
          <label className="fieldcell">
            <span className="label">Name</span>
            <input className="field field--sm" value={name} placeholder="Kel Brady"
              onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="fitrow">
            <span className="label">Fit for work today?</span>
            <div className="photo-add-pair">
              <button type="button" className={`button button--quiet fitbtn${fit ? ' fitbtn--on' : ''}`}
                style={{ marginTop: 0 }} onClick={() => setFit(true)}>
                Yes, fit
              </button>
              <button type="button" className={`button button--quiet fitbtn${!fit ? ' fitbtn--no' : ''}`}
                style={{ marginTop: 0 }} onClick={() => setFit(false)}>
                Not today
              </button>
            </div>
          </div>
          <SignaturePad saving={saving} onSave={addAttendee} />
        </div>
      )}

      {error && <p className="alert">{error}</p>}

      {!isDone && canRun && !editing && (
        <>
          <button className="button" type="button" disabled={finishing || signedCount === 0} onClick={finish}>
            {finishing ? 'Finishing…' : 'Finish the prestart'}
          </button>
          <p className="way-hint">
            {signedCount === 0
              ? 'You need at least one signature before you can finish.'
              : `Locks it with ${signedCount === 1 ? 'the one signature' : `all ${signedCount} signatures`}. After this nothing can be changed — that is what makes it a record.`}
          </p>
        </>
      )}
      {prestart.completed && (
        <>
          <button className="button" type="button" disabled={pdfBusy} onClick={downloadPdf}>
            {pdfBusy ? 'Making the PDF…' : 'Get the PDF'}
          </button>
          <p className="way-hint">
            One page with the briefing, the checks, everyone&rsquo;s signature and the Kooboolong
            logo — the daily record a principal or WorkSafe asks for.
          </p>
        </>
      )}
      </>)}
      <Link className="button button--quiet" href={`/prestart?project=${prestart.projectId}`}>
        All prestarts
      </Link>
    </main>
  );
}
