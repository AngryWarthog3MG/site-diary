'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { fmtDate } from '@/lib/pdf/dates';
import { PRESTART_CHECKS, type ChecklistState } from '@/lib/prestart/checklist';
import { parseTalkSummary } from '@/lib/toolbox/summary';

export interface SignablePrestart {
  id: string;
  projectId: string;
  jobName: string;
  jobCode: string;
  date: string;
  supervisor: string;
  work: string;
  hazards: string;
  plant: string;
  permits: string;
  notes: string;
  checklist: ChecklistState;
  /** When you signed on, if you have. */
  signedOnAt: string | null;
}

function Blocks({ text }: { text: string }) {
  return (
    <div className="talkread">
      {parseTalkSummary(text).map((block, i) =>
        block.kind === 'heading' ? <p key={i} className="talkread__head">{block.text}</p>
        : block.kind === 'points' ? <ul key={i} className="talkread__points">{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>
        : <p key={i} className="talkread__para">{block.text}</p>,
      )}
    </div>
  );
}

/**
 * Signing on to the day's prestart as yourself (README R141). Read the
 * briefing, say whether you are fit for work, sign. The name is your own from
 * your profile and the database accepts it for nobody else; the sign-on is the
 * same row the supervisor's phone writes, through the same offline queue.
 */
export function PrestartSignScreen({ userId, myName, list }: { userId: string; myName: string; list: SignablePrestart[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(list.length === 1 && !list[0].signedOnAt ? list[0].id : null);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [fit, setFit] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  void userId;

  async function signOn(p: SignablePrestart, blob: Blob) {
    if (!myName) { setError('Your name is not set yet — it is what goes on the sign-on.'); return; }
    setBusy(p.id); setError(null);
    try {
      const attendeeId = outbox.newId();
      const path = `${p.projectId}/prestart/${p.id}/sig-${attendeeId}.png`;
      const at = new Date().toISOString();
      const isFit = fit[p.id] ?? true;
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('prestart_attendees')
          .insert({ id: attendeeId, prestart_id: p.id, attendee_name: myName, fit_for_work: isFit, signature_path: path, inducted: null });
        if (insErr) {
          if (/row-level security/i.test(insErr.message)) throw new Error('This prestart is finished, or you have already signed on to it. Refresh to see.');
          throw new Error(insErr.message);
        }
      };
      const queue = () => outbox.enqueue({
        kind: 'prestart_attendee', projectId: p.projectId, subjectId: p.id,
        payload: { attendeeId, name: myName, fit: isFit, path, at, inducted: null }, blobs: { signature: blob },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome === 'sent') { setOpen(null); router.refresh(); }
      else setPending((prev) => ({ ...prev, [p.id]: at }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-on did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (list.length === 0) {
    return <p className="claims-nil">No open prestart on your jobs today. Your supervisor starts it at the briefing; once it is open it appears here, and once it is finished it is on the record.</p>;
  }

  return (
    <div className="swms-sign">
      {list.map((p) => {
        const done = p.signedOnAt ?? pending[p.id] ?? null;
        const isOpen = open === p.id;
        const checks = PRESTART_CHECKS.filter((c) => p.checklist[c.key] === true);
        return (
          <section key={p.id} className={`prestart-row ${done ? 'prestart-row--done' : 'prestart-row--open'} swms-sign__card`}>
            <button type="button" className="swms-sign__head" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
              <span className="machine__name">{p.jobName}</span>
              <span className="machine__meta">
                Prestart {fmtDate(p.date)} · by {p.supervisor}
                {done ? ` · you signed on${pending[p.id] && !p.signedOnAt ? ' (waiting for signal)' : ''}` : ' · not signed on'}
              </span>
            </button>

            {isOpen && (
              <div className="swms-sign__body">
                <div className="item">
                  <p className="label">Work planned today</p>
                  <Blocks text={p.work} />
                </div>
                <div className="item">
                  <p className="label">Hazards and controls</p>
                  <Blocks text={p.hazards} />
                </div>
                {p.plant.trim() && <div className="item"><p className="label">Plant</p><Blocks text={p.plant} /></div>}
                {p.permits.trim() && <div className="item"><p className="label">Permits</p><Blocks text={p.permits} /></div>}
                {p.notes.trim() && <div className="item"><p className="label">Notes</p><Blocks text={p.notes} /></div>}
                {checks.length > 0 && (
                  <div className="item">
                    <p className="label">Checked by the supervisor</p>
                    <ul className="talkread__points">{checks.map((c) => <li key={c.key}>{c.label}</li>)}</ul>
                  </div>
                )}

                {done ? (
                  <p className="notice">You signed on to this prestart. Your supervisor finishes it once everyone has.</p>
                ) : (
                  <div className="item">
                    <label className={`checkrow${read[p.id] ? ' checkrow--on' : ''}`}>
                      <input type="checkbox" checked={Boolean(read[p.id])} onChange={(e) => setRead((r) => ({ ...r, [p.id]: e.target.checked }))} />
                      <span>I was at the briefing, I have read this, and I will work to it.</span>
                    </label>
                    <div className="fitrow">
                      <span className="label">Fit for work today?</span>
                      <div className="photo-add-pair">
                        <button type="button" className={`button button--quiet fitbtn${(fit[p.id] ?? true) ? ' fitbtn--on' : ''}`} style={{ marginTop: 0 }} onClick={() => setFit((f) => ({ ...f, [p.id]: true }))}>Yes, fit</button>
                        <button type="button" className={`button button--quiet fitbtn${(fit[p.id] ?? true) ? '' : ' fitbtn--no'}`} style={{ marginTop: 0 }} onClick={() => setFit((f) => ({ ...f, [p.id]: false }))}>Not today</button>
                      </div>
                    </div>
                    <p className="caption">Signing on as <strong>{myName || 'your name — not set yet'}</strong>. Draw your signature, then save.</p>
                    {error && <p className="alert">{error}</p>}
                    <SignaturePad disabled={!read[p.id] || !myName} saving={busy === p.id} onSave={(blob) => void signOn(p, blob)} />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
