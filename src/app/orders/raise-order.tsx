'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { compressPhoto } from '@/lib/photos/compress';
import { ORDER_KINDS, KIND_LABEL, KIND_HINT, type OrderKind } from '@/lib/orders/model';

interface Props { projectId: string; userId: string; plant: string[] }

/**
 * Raising one takes seconds: what, how much, which machine if it is a fault,
 * by when, urgent or not, a photo if it helps. Saved at once — queued if there
 * is no signal. The number is the database's.
 */
export function RaiseOrder({ projectId, userId, plant }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OrderKind>('material');
  const [item, setItem] = useState('');
  const [quantity, setQuantity] = useState('');
  const [machine, setMachine] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Array<{ blob: Blob; type: string; ext: string; preview: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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

  function reset() {
    setItem(''); setQuantity(''); setMachine(''); setNeededBy(''); setUrgent(false); setNotes(''); setPhotos([]);
  }

  async function submit() {
    if (!item.trim()) { setError(kind === 'plant_issue' ? 'Say what is wrong.' : 'Say what is needed.'); return; }
    if (kind === 'plant_issue' && !machine.trim()) { setError('Say which machine.'); return; }
    setBusy(true); setError(null); setSaved(null);
    const id = outbox.newId();
    const at = new Date().toISOString();
    const photoPaths = photos.map((p) => `${projectId}/order/${id}/${outbox.newId()}.${p.ext}`);
    const row = {
      kind, item: item.trim(), quantity: quantity.trim() || null, plant: machine.trim() || null,
      needed_by: neededBy || null, urgent, notes: notes.trim() || null, raised_by: userId,
    };
    try {
      const live = async () => {
        const supabase = createClient();
        for (let i = 0; i < photos.length; i += 1) {
          const { error: upErr } = await supabase.storage.from('entry-photos').upload(photoPaths[i], photos[i].blob, { contentType: photos[i].type, upsert: false });
          if (upErr) throw new Error(upErr.message);
        }
        const { error: insErr } = await supabase.from('orders').insert({ id, project_id: projectId, ...row, photo_urls: photoPaths, raised_on_device_at: at });
        if (insErr) throw new Error(insErr.message);
        if (row.urgent) {
          const n = await fetch(`/api/orders/${id}/notify`, { method: 'POST' }).catch(() => null);
          if (n && !n.ok) window.alert('It is on the list. The office email did not go through — ring them. The app will retry tonight.');
        }
      };
      const queue = () => outbox.enqueue({
        kind: 'order_raise', projectId, subjectId: id,
        payload: { row, at, photoPaths, photoTypes: photos.map((p) => p.type) },
        blobs: Object.fromEntries(photos.map((p, i) => [`photo-${i}`, p.blob])),
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setSaved(outcome === 'sent' ? `${row.item} is on the list.` : `${row.item} is saved on the phone and goes when there is signal.`);
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'It did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div id="raise">
        <button type="button" className="button" onClick={() => setOpen(true)}>Add an order or plant issue</button>
        {saved && <p className="notice" role="status">{saved}</p>}
      </div>
    );
  }

  return (
    <div className="report-form raise-order" id="raise">
      <div className="crewchips">
        {ORDER_KINDS.map((k) => (
          <button key={k} type="button" className={`quotebtn crewchip${kind === k ? ' crewchip--on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <p className="caption">{KIND_HINT[kind]}</p>
      <label className="fieldcell"><span className="label">{kind === 'plant_issue' ? 'What is wrong' : 'What is needed'}</span>
        <input className="field" value={item} autoFocus placeholder={kind === 'plant_issue' ? 'Work light not working' : 'Diesel, marking paint, 100 mm PVC bends…'} onChange={(e) => setItem(e.target.value)} /></label>
      <div className="signin__grid">
        {kind === 'material' ? (
          <label className="fieldcell"><span className="label">How much</span>
            <input className="field field--sm" value={quantity} placeholder="400 L, 2 boxes, 6 off" onChange={(e) => setQuantity(e.target.value)} /></label>
        ) : (
          <label className="fieldcell"><span className="label">Which machine</span>
            <input className="field field--sm" value={machine} list="order-plant" placeholder="From the plant list, or type it" onChange={(e) => setMachine(e.target.value)} /></label>
        )}
        <label className="fieldcell fieldcell--narrow"><span className="label">Needed by</span>
          <input className="field field--sm" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></label>
      </div>
      {kind === 'material' && (
        <label className="fieldcell"><span className="label">For which machine, if any</span>
          <input className="field field--sm" value={machine} list="order-plant" placeholder="Optional" onChange={(e) => setMachine(e.target.value)} /></label>
      )}
      <datalist id="order-plant">{plant.map((p) => <option key={p} value={p} />)}</datalist>
      <label className={`checkrow${urgent ? ' checkrow--on' : ''}`}>
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        <span>Urgent — work stops or is unsafe without it</span>
      </label>
      <label className="fieldcell"><span className="label">Anything else</span>
        <textarea className="field field--sm" rows={2} value={notes} placeholder="Part number, where it goes, who to ask…" onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="item">
        <p className="label">Photo</p>
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
      {saved && <p className="notice" role="status">{saved}</p>}
      <div className="photo-add-pair">
        <button type="button" className="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : kind === 'plant_issue' ? 'Report the issue' : 'Add to the list'}</button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Close</button>
      </div>
    </div>
  );
}
