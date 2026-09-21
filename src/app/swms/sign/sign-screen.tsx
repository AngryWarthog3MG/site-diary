'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { fmtDate } from '@/lib/pdf/dates';
import { KIND_LABEL, RISK_LABEL, hrcwLabel, type SwmsKind, type SwmsStep } from '@/lib/swms/model';
import { FiledDocument } from '@/app/swms/[id]/swms-screen';

export interface SignableSwms {
  id: string;
  kind: SwmsKind;
  title: string;
  activity: string | null;
  version: number;
  activated_at: string | null;
  file_path: string | null;
  file_name: string | null;
  hrcw: string[];
  ppe: string[];
  steps: SwmsStep[];
  prepared_by: string | null;
  /** When you signed on to this version, if you have. */
  signedOnAt: string | null;
}

/**
 * Signing on as yourself (README R89). Read the document — or the steps, when
 * it was written here — then sign. The name is your own from your profile, and
 * the database accepts it for nobody else. The same offline queue as the
 * supervisor's sign-on, so a signature drawn with no signal arrives when the
 * phone does.
 */
export function SignScreen({ projectId, userId, myName, list }: { projectId: string; userId: string; myName: string; list: SignableSwms[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(list.length === 1 && !list[0].signedOnAt ? list[0].id : null);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});

  async function signOn(s: SignableSwms, blob: Blob) {
    if (!myName) { setError('Your name is not set yet — it is what goes on the sign-on.'); return; }
    setBusy(s.id);
    setError(null);
    try {
      const signonId = outbox.newId();
      const path = `${projectId}/swms/${s.id}/sig-${signonId}.png`;
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('swms_signons').insert({
          id: signonId, swms_id: s.id, attendee_name: myName, signature_path: path, signed_on_device_at: at, created_by: userId,
        });
        if (insErr) {
          if (/swms_signons_one_per_person_idx|duplicate key/i.test(insErr.message)) throw new Error('You have already signed on to this version.');
          throw new Error(insErr.message);
        }
      };
      const queue = () => outbox.enqueue({
        kind: 'swms_signon', projectId, subjectId: s.id,
        payload: { signonId, name: myName, path, at, by: userId }, blobs: { signature: blob },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome === 'sent') { setOpen(null); router.refresh(); }
      else setPending((prev) => ({ ...prev, [s.id]: at }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-on did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (list.length === 0) {
    return <p className="claims-nil">No method statement is in use on this job yet. Your supervisor puts one into use; then it appears here.</p>;
  }

  return (
    <div className="swms-sign">
      {list.map((s) => {
        const done = s.signedOnAt ?? pending[s.id] ?? null;
        const isOpen = open === s.id;
        return (
          <section key={s.id} className={`prestart-row ${done ? 'prestart-row--done' : 'prestart-row--open'} swms-sign__card`}>
            <button type="button" className="swms-sign__head" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
              <span className="machine__name">{s.title}</span>
              <span className="machine__meta">
                {KIND_LABEL[s.kind]} · version {s.version}
                {done ? ` · you signed on ${fmtDate(done)}${pending[s.id] && !s.signedOnAt ? ' (waiting for signal)' : ''}` : ' · not signed on'}
              </span>
            </button>

            {isOpen && (
              <div className="swms-sign__body">
                {s.activity && <p className="caption">{s.activity}</p>}
                {s.file_path ? (
                  <FiledDocument path={s.file_path} name={s.file_name} />
                ) : (
                  <>
                    {s.kind === 'swms' && s.hrcw.length > 0 && (
                      <div className="item">
                        <p className="label">High-risk construction work</p>
                        <ul className="swms__hrcw">{s.hrcw.map((k) => <li key={k}>{hrcwLabel(k)}</li>)}</ul>
                      </div>
                    )}
                    <div className="item">
                      <p className="label">Steps, hazards and controls</p>
                      {s.steps.map((st, i) => (
                        <div key={i} className="swms__step">
                          <p className="swms__stepno mono">Step {i + 1}{st.risk_before || st.risk_after ? ` · risk ${st.risk_before ? RISK_LABEL[st.risk_before] : '—'} → ${st.risk_after ? RISK_LABEL[st.risk_after] : '—'}` : ''}</p>
                          <p><strong>{st.step}</strong></p>
                          <p><span className="label">Hazards</span> {st.hazards}</p>
                          <p><span className="label">Controls</span> {st.controls}</p>
                        </div>
                      ))}
                      {s.ppe.length > 0 && <p className="caption">PPE: {s.ppe.join(', ')}</p>}
                      <p className="caption">Prepared by {s.prepared_by ?? '—'}</p>
                    </div>
                  </>
                )}

                {done ? (
                  <p className="notice">You signed on to version {s.version} on {fmtDate(done)}. A revision is a new version and a new sign-on.</p>
                ) : (
                  <div className="item">
                    <label className={`checkrow${read[s.id] ? ' checkrow--on' : ''}`}>
                      <input type="checkbox" checked={Boolean(read[s.id])} onChange={(e) => setRead((r) => ({ ...r, [s.id]: e.target.checked }))} />
                      <span>I have read and understood this {KIND_LABEL[s.kind]} and will work to it.</span>
                    </label>
                    <p className="caption">Signing on as <strong>{myName || 'your name — not set yet'}</strong>. Draw your signature, then save.</p>
                    {error && <p className="alert">{error}</p>}
                    <SignaturePad disabled={!read[s.id] || !myName} saving={busy === s.id} onSave={(blob) => void signOn(s, blob)} />
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
