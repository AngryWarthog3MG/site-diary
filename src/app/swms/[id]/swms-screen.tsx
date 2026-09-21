'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { fmtDate } from '@/lib/pdf/dates';
import { normaliseName } from '@/lib/crew/tickets';
import { KIND_LABEL, KIND_LONG, RISK_LABEL, hrcwLabel, swmsProblems, type SwmsKind, type SwmsStep } from '@/lib/swms/model';

export interface SwmsView {
  id: string;
  projectId: string;
  kind: SwmsKind;
  title: string;
  activity: string | null;
  hrcw: string[];
  ppe: string[];
  permits: string | null;
  plant: string | null;
  legislation: string | null;
  prepared_by: string | null;
  reviewed_by: string | null;
  version: number;
  status: 'draft' | 'active' | 'superseded' | 'archived';
  activated_at: string | null;
  steps: SwmsStep[];
  /** The filed document, when it was uploaded rather than written here (README R89). */
  file_path: string | null;
  file_name: string | null;
  signons: Array<{ id: string; attendee_name: string; signature_path: string; signed_on_device_at: string; created_at: string }>;
  newer: { id: string; version: number; status: string } | null;
}

/** The filed method statement: opened by a link minted when asked for, since the bucket is private. */
export function FiledDocument({ path, name }: { path: string; name: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="item">
      <p className="label">The method statement</p>
      <p>{name ?? 'The filed document'}</p>
      <p className="caption">Uploaded as a document; the crew read it and sign on to it. Every signature below is to this file.</p>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { data } = await createClient().storage.from('swms-docs').createSignedUrl(path, 600);
          if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
          setBusy(false);
        }}
      >
        {busy ? 'Opening…' : 'Open the document'}
      </button>
    </div>
  );
}

interface Props {
  swms: SwmsView;
  crew: string[];
  canWrite: boolean;
  canSign: boolean;
  userId: string;
}

export function SwmsScreen({ swms, crew, canWrite, canSign, userId }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'doc' | 'signon'>('doc');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Array<{ id: string; name: string; previewUrl: string }>>([]);
  const problems = swmsProblems({ kind: swms.kind, hrcw: swms.hrcw, prepared_by: swms.prepared_by, steps: swms.steps });
  const isActive = swms.status === 'active';
  const signedNames = new Set([...swms.signons.map((s) => normaliseName(s.attendee_name)), ...pending.map((p) => normaliseName(p.name))]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (swms.signons.length === 0) return;
      const supabase = createClient();
      const { data } = await supabase.storage.from('entry-photos').createSignedUrls(swms.signons.map((s) => s.signature_path), 3600);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [swms.signons]);

  async function setStatus(status: 'active' | 'archived', label: string) {
    if (status === 'archived' && !window.confirm('Archive this SWMS? It stops taking sign-ons and cannot be put back into use — a new version would be needed.')) return;
    setBusy(status);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: upErr } = await supabase.from('swms').update({ status }).eq('id', swms.id).select('id');
      if (upErr) throw new Error(upErr.message);
      if (!data || data.length === 0) throw new Error(`Could not ${label}: not allowed from this account.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${label}.`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteDraft() {
    if (!window.confirm('Delete this draft? Nothing has been signed on to it.')) return;
    setBusy('delete');
    try {
      const supabase = createClient();
      const { data, error: delErr } = await supabase.from('swms').delete().eq('id', swms.id).select('id');
      if (delErr) throw new Error(delErr.message);
      if (!data || data.length === 0) throw new Error('Nothing was deleted — this is no longer a draft. Refresh.');
      router.push(`/swms?project=${swms.projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the draft.');
      setBusy(null);
    }
  }

  async function signOn(blob: Blob) {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name first, then sign.'); return; }
    if (signedNames.has(normaliseName(trimmed))) { setError(`${trimmed} has already signed on to this version.`); return; }
    setBusy('sign');
    setError(null);
    try {
      const signonId = outbox.newId();
      const path = `${swms.projectId}/swms/${swms.id}/sig-${signonId}.png`;
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('swms_signons').insert({
          id: signonId, swms_id: swms.id, attendee_name: trimmed, signature_path: path, signed_on_device_at: at, created_by: userId,
        });
        if (insErr) throw new Error(insErr.message);
      };
      const queue = () => outbox.enqueue({
        kind: 'swms_signon', projectId: swms.projectId, subjectId: swms.id,
        payload: { signonId, name: trimmed, path, at, by: userId }, blobs: { signature: blob },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome !== 'sent') setPending((prev) => [...prev, { id: signonId, name: trimmed, previewUrl: URL.createObjectURL(blob) }]);
      setName('');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-on did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    setBusy('pdf');
    setError(null);
    try {
      const res = await fetch(`/api/swms/${swms.id}/pdf`, { method: 'POST' });
      const body = (await res.json()) as { url?: string; error?: { message?: string } };
      if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The PDF could not be made.');
      window.open(body.url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The PDF could not be made.');
    } finally {
      setBusy(null);
    }
  }

  const statusLine = swms.status === 'draft' ? 'Draft — not yet in use'
    : swms.status === 'active' ? `In use since ${fmtDate(swms.activated_at)}`
    : swms.status === 'superseded' ? `Superseded${swms.newer ? ` by version ${swms.newer.version}` : ''}` : 'Archived';

  return (
    <section className="swms">
      <p className="label">{KIND_LONG[swms.kind]} · version {swms.version}</p>
      <h1 className="page-title">{swms.title}</h1>
      <p className={`page-subtitle ${swms.status === 'active' ? 'swms__status--active' : ''}`}>{statusLine}</p>
      {swms.newer && swms.newer.status === 'draft' && (
        <p className="notice">A revision (version {swms.newer.version}) is being drafted. <Link href={`/swms/${swms.newer.id}`}>Open it</Link>.</p>
      )}

      <div className="review-tabs" role="tablist">
        <button type="button" role="tab" className={`review-tab${tab === 'doc' ? ' is-active' : ''}`} onClick={() => setTab('doc')}>The {KIND_LABEL[swms.kind]}</button>
        <button type="button" role="tab" className={`review-tab${tab === 'signon' ? ' is-active' : ''}`} onClick={() => setTab('signon')}>
          Sign-on <span className="review-tab__count">{swms.signons.length + pending.length}</span>
        </button>
      </div>

      {tab === 'doc' && (
        <div className="swms__doc">
          {swms.activity && <p className="swms__activity">{swms.activity}</p>}
          {swms.file_path && <FiledDocument path={swms.file_path} name={swms.file_name} />}
          {!swms.file_path && swms.kind === 'swms' && (
            <div className="item">
              <p className="label">High-risk construction work</p>
              {swms.hrcw.length === 0 ? <p className="nil">None named</p> : <ul className="swms__hrcw">{swms.hrcw.map((k) => <li key={k}>{hrcwLabel(k)}</li>)}</ul>}
            </div>
          )}
          {!swms.file_path && <div className="item">
            <p className="label">Steps, hazards and controls</p>
            {swms.steps.length === 0 ? <p className="nil">No steps yet</p> : swms.steps.map((s, i) => (
              <div key={i} className="swms__step">
                <p className="swms__stepno mono">Step {i + 1}{s.risk_before || s.risk_after ? ` · risk ${s.risk_before ? RISK_LABEL[s.risk_before] : '—'} → ${s.risk_after ? RISK_LABEL[s.risk_after] : '—'}` : ''}</p>
                <p><strong>{s.step}</strong></p>
                <p><span className="label">Hazards</span> {s.hazards}</p>
                <p><span className="label">Controls</span> {s.controls}</p>
                {s.who && <p className="caption">Responsible: {s.who}</p>}
              </div>
            ))}
          </div>}
          {!swms.file_path && <div className="item">
            <p className="label">PPE, permits, plant</p>
            <p>{swms.ppe.length ? swms.ppe.join(', ') : 'No PPE listed'}</p>
            {swms.permits && <p><span className="label">Permits</span> {swms.permits}</p>}
            {swms.plant && <p><span className="label">Plant</span> {swms.plant}</p>}
            {swms.legislation && <p><span className="label">Legislation</span> {swms.legislation}</p>}
            <p className="caption">Prepared by {swms.prepared_by ?? '—'}{swms.reviewed_by ? ` · reviewed by ${swms.reviewed_by}` : ''}</p>
          </div>}

          {swms.status === 'draft' && canWrite && (
            <>
              {problems.length > 0 && <p className="notice gap">Before it can be put into use: {problems.join('; ')}.</p>}
              <div className="photo-add-pair">
                <Link className="button button--quiet" href={`/swms/${swms.id}/edit`}>Edit the draft</Link>
                <button type="button" className="button" disabled={busy != null || problems.length > 0} onClick={() => void setStatus('active', 'put it into use')}>
                  {busy === 'active' ? 'Putting into use…' : 'Put into use'}
                </button>
              </div>
              <button type="button" className="linklike" disabled={busy != null} onClick={() => void deleteDraft()}>Delete this draft</button>
            </>
          )}
          {isActive && canWrite && (
            <div className="photo-add-pair">
              <Link className="button button--quiet" href={`/swms/new?project=${swms.projectId}&revise=${swms.id}`}>Revise (new version)</Link>
              <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void setStatus('archived', 'archive it')}>
                {busy === 'archived' ? 'Archiving…' : 'Archive — work finished'}
              </button>
            </div>
          )}
          {swms.status !== 'draft' && (
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void downloadPdf()}>
              {busy === 'pdf' ? 'Making the PDF…' : 'PDF with sign-ons'}
            </button>
          )}
        </div>
      )}

      {tab === 'signon' && (
        <div className="swms__signon">
          <h2 className="home-card__title">{swms.signons.length + pending.length === 0 ? 'Nobody has signed on yet' : `${swms.signons.length + pending.length} signed on to version ${swms.version}`}</h2>
          {!isActive && <p className="notice">{swms.status === 'draft' ? 'Put it into use first; then the crew sign on.' : 'This version is no longer in use. Sign on to the current one.'}</p>}
          {pending.map((p) => (
            <div key={p.id} className="talk-attendee">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" />
              <span>{p.name}<span className="pending-tag">waiting for signal</span></span>
            </div>
          ))}
          {swms.signons.map((s) => (
            <div key={s.id} className="talk-attendee">
              {urls[s.signature_path] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={urls[s.signature_path]} alt="" />
              ) : <span className="talk-attendee__pending" />}
              <span>{s.attendee_name}<span className="caption"> · {fmtDate(s.signed_on_device_at)}</span></span>
            </div>
          ))}
          {isActive && canSign && (
            <div className="sigslot item" style={{ marginTop: '1rem' }}>
              <p className="label">Hand them the phone</p>
              <p className="way-hint">They read the {KIND_LABEL[swms.kind]}, tap or type their name, and sign: “I have read and understood this and will work to it.”</p>
              {crew.filter((c) => !signedNames.has(normaliseName(c))).length > 0 && (
                <div className="crewchips">
                  {crew.filter((c) => !signedNames.has(normaliseName(c))).map((c) => (
                    <button key={c} type="button" className={`quotebtn crewchip${name === c ? ' crewchip--on' : ''}`} onClick={() => setName(c)}>+ {c}</button>
                  ))}
                </div>
              )}
              <label className="fieldcell">
                <span className="label">Name</span>
                <input className="field field--sm" value={name} placeholder="Kel Brady" onChange={(e) => setName(e.target.value)} />
              </label>
              <SignaturePad saving={busy === 'sign'} onSave={signOn} />
            </div>
          )}
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </section>
  );
}
