'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { normaliseName } from '@/lib/crew/tickets';
import { PERMIT_KINDS, KIND_LABEL, controlsFor, allAnswered, type PermitKind, type Control, type ControlResult } from '@/lib/permits/model';

interface Props { projectId: string; userId: string; issuer: string; crew: string[]; plant: string[]; swms: Array<{ id: string; title: string; signed: string[] }> }

function localStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The permit on one screen: what, where, when, which SWMS, who; the
 * controls walked one by one; the issuer signs, then hands the phone to
 * the holder to sign. Sent as one thing, queued if there is no signal; the
 * database numbers and freezes it.
 */
export function PermitForm({ projectId, userId, issuer, crew, plant, swms }: Props) {
  const router = useRouter();
  const now = new Date();
  const [kind, setKind] = useState<PermitKind>('excavation');
  const [controls, setControls] = useState<Control[]>(controlsFor('excavation'));
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [from, setFrom] = useState(localStamp(now));
  const [to, setTo] = useState(localStamp(new Date(now.getTime() + 8 * 3600000)));
  const [swmsId, setSwmsId] = useState('');
  const [plantItem, setPlantItem] = useState('');
  const [workers, setWorkers] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [conditions, setConditions] = useState('');
  const [issuerName, setIssuerName] = useState(issuer);
  const [holder, setHolder] = useState('');
  const [issuerSig, setIssuerSig] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickKind = (k: PermitKind) => { setKind(k); setControls(controlsFor(k)); };
  const answer = (key: string, result: ControlResult) => setControls(controls.map((c) => (c.key === key ? { ...c, result } : c)));
  const chosenSwms = swms.find((s) => s.id === swmsId);
  const unsigned = chosenSwms ? workers.filter((w) => !chosenSwms.signed.some((s) => normaliseName(s) === normaliseName(w))) : [];
  const ready = title.trim() && issuerName.trim() && holder.trim() && allAnswered(controls) && from < to;

  async function issue(holderSig: Blob) {
    if (!issuerSig) { setError('The issuer signs first.'); return; }
    if (!ready) { setError('Answer every control, name the holder, and check the window.'); return; }
    setBusy(true); setError(null);
    const id = outbox.newId();
    const at = new Date().toISOString();
    const issuerPath = `${projectId}/permit/${id}/issuer-${outbox.newId()}.png`;
    const holderPath = `${projectId}/permit/${id}/holder-${outbox.newId()}.png`;
    const row = {
      kind, title: title.trim(), location: location.trim() || null, valid_from: new Date(from).toISOString(), valid_to: new Date(to).toISOString(),
      swms_id: swmsId || null, plant: plantItem.trim() || null, workers, controls, conditions: conditions.trim() || null,
      issuer_name: issuerName.trim(), holder_name: holder.trim(), issued_by: userId,
    };
    try {
      const live = async () => {
        const supabase = createClient();
        for (const [path, blob] of [[issuerPath, issuerSig], [holderPath, holderSig]] as Array<[string, Blob]>) {
          const { error: e } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
          if (e) throw new Error(e.message);
        }
        const { error: rowErr } = await supabase.from('permits').insert({ id, project_id: projectId, ...row });
        if (rowErr) throw new Error(rowErr.message);
        const { data, error: issueErr } = await supabase.from('permits')
          .update({ status: 'issued', issuer_signature_path: issuerPath, holder_signature_path: holderPath, issued_on_device_at: at }).eq('id', id).select('id');
        if (issueErr) throw new Error(issueErr.message);
        if (!data || data.length === 0) throw new Error('The permit was saved but could not be issued from this account.');
      };
      const queue = () => outbox.enqueue({
        kind: 'permit_issue', projectId, subjectId: id, payload: { row, at, issuerPath, holderPath }, blobs: { issuer: issuerSig, holder: holderSig },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      router.push(outcome === 'sent' ? `/permits/${id}` : `/permits?project=${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The permit did not issue.');
      setBusy(false);
    }
  }

  return (
    <div className="permit-form">
      <div className="item">
        <p className="label">Kind of work</p>
        <div className="crewchips">
          {PERMIT_KINDS.map((k) => <button key={k} type="button" className={`quotebtn crewchip${kind === k ? ' crewchip--on' : ''}`} onClick={() => pickKind(k)}>{KIND_LABEL[k]}</button>)}
        </div>
      </div>
      <label className="fieldcell"><span className="label">Task</span><input className="field field--sm" value={title} placeholder="Weld the bypass flange at the pump pit" onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="fieldcell"><span className="label">Where</span><input className="field field--sm" value={location} placeholder="Chainage, area, structure" onChange={(e) => setLocation(e.target.value)} /></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">From</span><input className="field field--sm" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">To</span><input className="field field--sm" type="datetime-local" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">SWMS in use for this task</span>
        <select className="field field--sm" value={swmsId} onChange={(e) => setSwmsId(e.target.value)}>
          <option value="">— none named —</option>
          {swms.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select></label>
      <label className="fieldcell"><span className="label">Plant</span><input className="field field--sm" value={plantItem} list="permit-plant" placeholder="Optional" onChange={(e) => setPlantItem(e.target.value)} /></label>
      <datalist id="permit-plant">{plant.map((p) => <option key={p} value={p} />)}</datalist>

      <div className="item">
        <p className="label">Workers under this permit</p>
        <div className="crewchips">
          {workers.map((w) => <button key={w} type="button" className="quotebtn crewchip crewchip--on" onClick={() => setWorkers(workers.filter((x) => x !== w))}>{w} ×</button>)}
          {crew.filter((c) => !workers.some((w) => normaliseName(w) === normaliseName(c))).map((c) => <button key={c} type="button" className="quotebtn crewchip" onClick={() => setWorkers([...workers, c])}>+ {c}</button>)}
        </div>
        <div className="signin__grid">
          <input className="field field--sm" value={typed} placeholder="Someone else — type a name" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (typed.trim()) setWorkers([...workers, typed.trim()]); setTyped(''); } }} />
          <button type="button" className="button button--quiet" style={{ marginTop: 0, width: 'auto' }} disabled={!typed.trim()} onClick={() => { setWorkers([...workers, typed.trim()]); setTyped(''); }}>Add</button>
        </div>
        {unsigned.length > 0 && <p className="notice gap">Not yet signed on to that SWMS: {unsigned.join(', ')}. Sign them on before the work starts.</p>}
      </div>

      <div className="item">
        <p className="label">Controls — every one answered</p>
        <ul className="tri-list">
          {controls.map((c) => (
            <li key={c.key} className={`tri${c.result === 'yes' ? ' tri--ok' : c.result === 'na' ? ' tri--na' : ''}`}>
              <p className="tri__label">{c.label}</p>
              <div className="tri__buttons permit-form__pair">
                <button type="button" className={`tri__btn${c.result === 'yes' ? ' tri__btn--ok' : ''}`} onClick={() => answer(c.key, 'yes')}>Yes, in place</button>
                <button type="button" className={`tri__btn${c.result === 'na' ? ' tri__btn--na' : ''}`} onClick={() => answer(c.key, 'na')}>N/A</button>
              </div>
            </li>
          ))}
        </ul>
        <label className="fieldcell"><span className="label">Special conditions</span><textarea className="field field--sm" rows={2} value={conditions} placeholder="Optional — anything the controls do not say" onChange={(e) => setConditions(e.target.value)} /></label>
      </div>

      <div className="item">
        <p className="label">Issued by</p>
        <input className="field field--sm" value={issuerName} onChange={(e) => setIssuerName(e.target.value)} />
        {issuerSig ? <p className="caption">Issuer signed. <button type="button" className="linklike" onClick={() => setIssuerSig(null)}>Sign again</button></p> : <SignaturePad disabled={busy} onSave={(b) => setIssuerSig(b)} />}
      </div>
      <div className="item">
        <p className="label">Accepted by the permit holder</p>
        <input className="field field--sm" value={holder} list="permit-holder" placeholder="Who is in charge of the work" onChange={(e) => setHolder(e.target.value)} />
        <datalist id="permit-holder">{crew.map((c) => <option key={c} value={c} />)}</datalist>
        <p className="way-hint">They have read the permit and the controls and accept them. Their signature issues it.</p>
        {error && <p className="alert" role="alert">{error}</p>}
        <SignaturePad disabled={busy || !issuerSig || !ready} saving={busy} onSave={issue} />
      </div>
    </div>
  );
}
