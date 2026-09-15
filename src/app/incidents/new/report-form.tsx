'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { compressPhoto } from '@/lib/photos/compress';
import { normaliseName } from '@/lib/crew/tickets';
import {
  INCIDENT_KINDS, KIND_LABEL, TREATMENTS, TREATMENT_LABEL, SEVERITIES, SEVERITY_LABEL,
  type IncidentKind, type Treatment, type Severity,
} from '@/lib/incidents/model';

interface Props { projectId: string; userId: string; crew: string[]; plant: string[] }

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The report, made on the phone. Saved at once — queued if there is no
 * signal — and frozen from then on; the office is emailed for anything
 * urgent. Nothing here is a guess: unanswered stays blank.
 */
export function ReportForm({ projectId, userId, crew, plant }: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<IncidentKind>('hazard');
  const [occurred, setOccurred] = useState(localNow());
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [immediate, setImmediate] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [witnesses, setWitnesses] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [typedWitness, setTypedWitness] = useState('');
  const [injured, setInjured] = useState('');
  const [injuryType, setInjuryType] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [treatment, setTreatment] = useState<Treatment | ''>('');
  const [actual, setActual] = useState<Severity | ''>('');
  const [potential, setPotential] = useState<Severity | ''>('');
  const [notifiable, setNotifiable] = useState(false);
  const [plantItem, setPlantItem] = useState('');
  const [photos, setPhotos] = useState<Array<{ blob: Blob; type: string; ext: string; preview: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInjury = kind === 'injury';
  const addName = (list: string[], set: (v: string[]) => void, name: string) => {
    const t = name.trim();
    if (!t || list.some((n) => normaliseName(n) === normaliseName(t))) return;
    set([...list, t]);
  };

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const next = [] as typeof photos;
      for (const f of Array.from(files)) {
        const c = await compressPhoto(f);
        next.push({ blob: c.blob, type: c.contentType, ext: c.extension, preview: URL.createObjectURL(c.blob) });
      }
      setPhotos((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? `Photo could not be read: ${err.message}` : 'Photo could not be read.');
    }
  }

  async function submit() {
    if (!description.trim()) { setError('Say what happened.'); return; }
    setBusy(true);
    setError(null);
    const id = outbox.newId();
    const at = new Date().toISOString();
    const occurredIso = new Date(occurred).toISOString();
    const photoPaths = photos.map((p) => `${projectId}/incident/${id}/${outbox.newId()}.${p.ext}`);
    const row = {
      kind, occurred_at: occurredIso, location: location.trim() || null, description: description.trim(),
      immediate_actions: immediate.trim() || null, people_involved: people, witnesses,
      injured_name: isInjury ? injured.trim() || null : null, injury_type: isInjury ? injuryType.trim() || null : null,
      body_part: isInjury ? bodyPart.trim() || null : null, treatment: isInjury && treatment ? treatment : null,
      actual_severity: actual || null, potential_severity: potential || null, notifiable, plant: plantItem.trim() || null,
      reported_by: userId,
    };
    try {
      const live = async () => {
        const supabase = createClient();
        for (let i = 0; i < photos.length; i += 1) {
          const { error: upErr } = await supabase.storage.from('entry-photos').upload(photoPaths[i], photos[i].blob, { contentType: photos[i].type, upsert: false });
          if (upErr) throw new Error(upErr.message);
        }
        const { error: insErr } = await supabase.from('incidents').insert({ id, project_id: projectId, ...row, photo_urls: photoPaths, reported_on_device_at: at });
        if (insErr) throw new Error(insErr.message);
        const n = await fetch(`/api/incidents/${id}/notify`, { method: 'POST' }).catch(() => null);
        if (n && !n.ok) window.alert('The report is saved. The office email did not go through — ring them. The app will retry tonight.');
      };
      const queue = () => outbox.enqueue({
        kind: 'incident_report', projectId, subjectId: id,
        payload: { row, at, photoPaths, photoTypes: photos.map((p) => p.type) },
        blobs: Object.fromEntries(photos.map((p, i) => [`photo-${i}`, p.blob])),
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      router.push(outcome === 'sent' ? `/incidents/${id}` : `/incidents?project=${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report did not save.');
      setBusy(false);
    }
  }

  const chips = (list: string[], set: (v: string[]) => void, typedValue: string, setTypedValue: (v: string) => void, placeholder: string) => (
    <>
      <div className="crewchips">
        {list.map((n) => (
          <button key={n} type="button" className="quotebtn crewchip crewchip--on" onClick={() => set(list.filter((x) => x !== n))}>{n} ×</button>
        ))}
        {crew.filter((c) => !list.some((n) => normaliseName(n) === normaliseName(c))).map((c) => (
          <button key={c} type="button" className="quotebtn crewchip" onClick={() => addName(list, set, c)}>+ {c}</button>
        ))}
      </div>
      <div className="signin__grid">
        <input className="field field--sm" value={typedValue} placeholder={placeholder} onChange={(e) => setTypedValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addName(list, set, typedValue); setTypedValue(''); } }} />
        <button type="button" className="button button--quiet" style={{ marginTop: 0, width: 'auto' }} disabled={!typedValue.trim()} onClick={() => { addName(list, set, typedValue); setTypedValue(''); }}>Add</button>
      </div>
    </>
  );

  return (
    <div className="report-form">
      <div className="item">
        <p className="label">What kind of report</p>
        <div className="crewchips">
          {INCIDENT_KINDS.map((k) => (
            <button key={k} type="button" className={`quotebtn crewchip${kind === k ? ' crewchip--on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
      </div>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">When</span>
          <input className="field field--sm" type="datetime-local" value={occurred} max={localNow()} onChange={(e) => setOccurred(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Where</span>
          <input className="field field--sm" value={location} placeholder="Chainage, area, gate…" onChange={(e) => setLocation(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">What happened</span>
        <textarea className="field field--sm" rows={4} value={description} placeholder="In plain words, as you saw it." onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="fieldcell"><span className="label">What was done straight away</span>
        <textarea className="field field--sm" rows={2} value={immediate} placeholder="Area fenced off, machine tagged out, first aid given…" onChange={(e) => setImmediate(e.target.value)} /></label>

      {isInjury && (
        <div className="item">
          <p className="label">The person hurt</p>
          <label className="fieldcell"><span className="label">Name</span>
            <input className="field field--sm" value={injured} list="incident-crew" onChange={(e) => setInjured(e.target.value)} /></label>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Injury</span>
              <input className="field field--sm" value={injuryType} placeholder="Cut, strain, crush, burn…" onChange={(e) => setInjuryType(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Body part</span>
              <input className="field field--sm" value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} /></label>
          </div>
          <label className="fieldcell"><span className="label">Treatment</span>
            <select className="field field--sm" value={treatment} onChange={(e) => setTreatment(e.target.value as Treatment | '')}>
              <option value="">—</option>
              {TREATMENTS.map((t) => <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>)}
            </select></label>
        </div>
      )}

      <div className="item">
        <p className="label">People involved</p>
        {chips(people, setPeople, typed, setTyped, 'Someone else — type a name')}
        <p className="label" style={{ marginTop: '0.75rem' }}>Witnesses</p>
        {chips(witnesses, setWitnesses, typedWitness, setTypedWitness, 'Type a name')}
        <datalist id="incident-crew">{crew.map((c) => <option key={c} value={c} />)}</datalist>
      </div>

      <div className="signin__grid">
        <label className="fieldcell"><span className="label">How bad was it</span>
          <select className="field field--sm" value={actual} onChange={(e) => setActual(e.target.value as Severity | '')}>
            <option value="">—</option>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </select></label>
        <label className="fieldcell"><span className="label">How bad could it have been</span>
          <select className="field field--sm" value={potential} onChange={(e) => setPotential(e.target.value as Severity | '')}>
            <option value="">—</option>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </select></label>
      </div>
      <label className="fieldcell"><span className="label">Plant involved</span>
        <input className="field field--sm" value={plantItem} list="incident-plant" placeholder="Optional" onChange={(e) => setPlantItem(e.target.value)} /></label>
      <datalist id="incident-plant">{plant.map((p) => <option key={p} value={p} />)}</datalist>

      <label className={`checkrow${notifiable ? ' checkrow--on' : ''}`}>
        <input type="checkbox" checked={notifiable} onChange={(e) => setNotifiable(e.target.checked)} />
        <span>Notifiable to WorkSafe — a death, serious injury or illness, or a dangerous incident</span>
      </label>
      {notifiable && (
        <p className="alert" role="alert">
          Notify WorkSafe WA immediately by phone on <a href="tel:1800678198"><strong>1800 678 198</strong></a> (24 hours), and do not
          disturb the site until an inspector says so. Keep this report for at least two years.
        </p>
      )}

      <div className="item">
        <p className="label">Photos</p>
        <div className="photo-add-pair">
          <label className="button button--quiet" style={{ marginTop: 0 }}>Take photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addPhotos(e.target.files)} /></label>
          <label className="button button--quiet" style={{ marginTop: 0 }}>From phone<input type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} /></label>
        </div>
        {photos.length > 0 && (
          <div className="photos__grid report-form__photos">
            {photos.map((p, i) => (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="" />
                <button type="button" className="linklike" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>Remove</button>
              </figure>
            ))}
          </div>
        )}
      </div>

      {error && <p className="alert" role="alert">{error}</p>}
      <button type="button" className="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Reporting…' : 'Report'}</button>
      <p className="caption">Once reported it cannot be edited; anything more goes on as an update.</p>
    </div>
  );
}
