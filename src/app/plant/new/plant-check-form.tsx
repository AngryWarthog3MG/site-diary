'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/brand-mark';
import { SignaturePad } from '@/components/signature-pad';
import { compressPhoto } from '@/lib/photos/compress';
import { localDate } from '@/lib/capture/queue';
import { fmtDate } from '@/lib/pdf/dates';
import { PLANT_CHECKS, PLANT_KIND_LABEL, isPlantKind, allAnswered, type CheckResult, type PlantKind, type StoredCheck } from '@/lib/plant/checklist';
import { AddPlantForm, type RegisterRow } from '../plant-register';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';

/**
 * The walk-around, on the phone. Pick the machine (search the register, or
 * add one), answer every check, note and photograph any defect, read the
 * hour meter, say whether it is fit to use, sign. Nothing is pre-answered;
 * the signature is what saves it, and from then on it is frozen.
 */
export function PlantCheckForm({ projectId, projectName, orgId, register, onJob, preselect, defaultOperator }: {
  projectId: string; projectName: string; orgId: string; register: RegisterRow[]; onJob: string[]; preselect: string | null; defaultOperator: string;
}) {
  const onJobSet = new Set(onJob);
  const router = useRouter();
  const [rows, setRows] = useState(register);
  const [plantId, setPlantId] = useState<string | null>(preselect && register.some((r) => r.id === preselect) ? preselect : null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [operator, setOperator] = useState(defaultOperator);
  const [hourMeter, setHourMeter] = useState('');
  const [answers, setAnswers] = useState<Record<string, CheckResult | undefined>>({});
  const [defectNotes, setDefectNotes] = useState<Record<string, string>>({});
  const [defectPhotos, setDefectPhotos] = useState<Record<string, File | undefined>>({});
  const [fit, setFit] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plant = rows.find((r) => r.id === plantId) ?? null;
  const kind: PlantKind = plant && isPlantKind(plant.kind) ? plant.kind : 'other';
  const items = PLANT_CHECKS[kind];
  const defects = items.filter((i) => answers[i.key] === 'defect');
  const answered = plant ? allAnswered(kind, answers) : false;
  const fitDecided = defects.length === 0 ? true : fit != null;
  const ready = Boolean(plant) && operator.trim().length > 0 && answered && fitDecided;
  const today = localDate();

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !q || `${r.name} ${r.plant_no ?? ''} ${r.make_model ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(onJobSet.has(b.id)) - Number(onJobSet.has(a.id)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search]);

  function answer(key: string, result: CheckResult) {
    setAnswers((a) => ({ ...a, [key]: a[key] === result ? undefined : result }));
    if (result !== 'defect') setFit(null);
  }

  async function sign(signature: Blob) {
    if (!plant || !ready) return;
    setSaving(true); setError(null);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('You are signed out.');
      const checks: StoredCheck[] = items.map((i) => ({ key: i.key, label: i.label, result: answers[i.key] as CheckResult }));
      const fitForUse = defects.length === 0 ? true : Boolean(fit);
      // Everything the record needs is decided here, on the phone: ids, paths,
      // the time. With signal it is written now; without, it is kept and sent
      // later exactly as it was.
      const id = outbox.newId();
      const at = new Date().toISOString();
      const base = `${projectId}/plant/${id}`;
      const sigPath = `${base}/sig.png`;
      const putOnJob = !onJobSet.has(plant.id);
      const row = { id, project_id: projectId, plant_id: plant.id, prestart_date: today, operator_name: operator.trim(), hour_meter: hourMeter.trim() ? Number(hourMeter) : null, checks, fit_for_use: fitForUse, notes: notes.trim() || null, conducted_by: userId, created_at: at };
      const defectPlans: Array<{ row: Record<string, unknown>; blob?: Blob; contentType?: string; photoPath?: string; photoKey?: string }> = [];
      for (const item of defects) {
        const file = defectPhotos[item.key];
        let blob: Blob | undefined; let contentType: string | undefined; let photoPath: string | undefined;
        if (file) {
          const photo = await compressPhoto(file);
          blob = photo.blob; contentType = photo.contentType; photoPath = `${base}/defect-${item.key}.${photo.extension}`;
        }
        defectPlans.push({
          row: { id: outbox.newId(), project_id: projectId, plant_id: plant.id, prestart_id: id, item_key: item.key, item_label: item.label, note: defectNotes[item.key]?.trim() || null, photo_path: photoPath ?? null, raised_by: userId, raised_at: at },
          blob, contentType, photoPath, photoKey: blob ? `defect-${item.key}` : undefined,
        });
      }

      const live = async () => {
        if (putOnJob) {
          const { error: jobErr } = await supabase.from('project_plant').upsert({ project_id: projectId, plant_id: plant.id, active: true }, { onConflict: 'project_id,plant_id' });
          if (jobErr) throw new Error(`Could not put ${plant.name} on this job: ${jobErr.message}`);
        }
        const { error: insertError } = await supabase.from('plant_prestarts').insert(row);
        if (insertError) throw new Error(insertError.message);
        for (const d of defectPlans) {
          if (d.blob && d.photoPath) {
            const { error: upErr } = await supabase.storage.from('entry-photos').upload(d.photoPath, d.blob, { contentType: d.contentType, upsert: false });
            if (upErr) throw new Error(upErr.message);
          }
          const { error: defErr } = await supabase.from('plant_defects').insert(d.row);
          if (defErr) throw new Error(defErr.message);
        }
        const { error: sigErr } = await supabase.storage.from('entry-photos').upload(sigPath, signature, { contentType: 'image/png', upsert: false });
        if (sigErr) throw new Error(sigErr.message);
        // The signature arriving completes it; the database stamps the time.
        const { error: doneErr } = await supabase.from('plant_prestarts').update({ signature_path: sigPath, completed_on_device_at: at }).eq('id', id);
        if (doneErr) throw new Error(doneErr.message);
      };
      const queue = async () => {
        const blobs: Record<string, Blob> = { signature };
        for (const d of defectPlans) if (d.blob && d.photoKey) blobs[d.photoKey] = d.blob;
        await outbox.enqueue({
          kind: 'plant_prestart', projectId, subjectId: id,
          payload: { plantId: plant.id, plantName: plant.name, putOnJob, row, sigPath, at, defects: defectPlans.map((d) => ({ row: d.row, photoKey: d.photoKey, photoPath: d.photoPath, contentType: d.contentType })) },
          blobs,
        });
      };
      const outcome = await runOrQueue(live, queue);
      router.push(outcome === 'sent' ? `/plant/${id}` : `/plant?project=${projectId}&kept=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The prestart did not save.');
      setSaving(false);
    }
  }

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {projectName}</p>
      <h1 className="page-title">Plant prestart</h1>
      <p className="page-subtitle">{fmtDate(today)} · walk around the machine before it starts, answer every check, sign.</p>
      <hr className="rule" />

      {!plant ? (
        <>
          <label className="fieldcell">
            <span className="label">Which machine</span>
            <input className="field" type="search" autoFocus value={search} placeholder="Search the register — excavator, vac, KBS-01…" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <ul className="plantpick">
            {matches.map((r) => (
              <li key={r.id}>
                <button type="button" className="plantpick__item" onClick={() => setPlantId(r.id)}>
                  <span className="machine__name">{r.name}</span>
                  <span className="machine__meta">{[isPlantKind(r.kind) ? PLANT_KIND_LABEL[r.kind] : r.kind, r.plant_no, r.make_model, onJobSet.has(r.id) ? 'on this job' : null].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="caption">Nothing on the register matches &ldquo;{search}&rdquo;.</li>}
          </ul>
          {adding ? (
            <AddPlantForm orgId={orgId} compact onAdded={(row) => { setRows([...rows, row]); setPlantId(row.id); setAdding(false); }} />
          ) : (
            <button type="button" className="linklike" onClick={() => setAdding(true)}>Not on the list — add a machine</button>
          )}
        </>
      ) : (
        <>
          <div className="machine machine--picked">
            <div>
              <p className="machine__name">{plant.name}</p>
              <p className="machine__meta">{[PLANT_KIND_LABEL[kind], plant.plant_no, plant.make_model].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" className="quotebtn" onClick={() => { setPlantId(null); setAnswers({}); setFit(null); }}>Change</button>
          </div>

          <div className="photo-add-pair">
            <label className="fieldcell" style={{ flex: 2 }}>
              <span className="label">Operator</span>
              <input className="field field--sm" value={operator} onChange={(e) => setOperator(e.target.value)} />
            </label>
            <label className="fieldcell" style={{ flex: 1 }}>
              <span className="label">Hour meter</span>
              <input className="field field--sm mono" inputMode="decimal" value={hourMeter} placeholder="1234.5" onChange={(e) => setHourMeter(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
          </div>

          <p className="label" style={{ marginTop: '1rem' }}>Checks · {Object.values(answers).filter(Boolean).length} of {items.length} answered</p>
          <ul className="tri-list">
            {items.map((item) => {
              const a = answers[item.key];
              return (
                <li key={item.key} className={`tri${a ? ` tri--${a}` : ''}`}>
                  <p className="tri__label">{item.label}</p>
                  <div className="tri__buttons" role="group" aria-label={item.label}>
                    <button type="button" className={`tri__btn tri__btn--ok${a === 'ok' ? ' is-on' : ''}`} onClick={() => answer(item.key, 'ok')}>OK</button>
                    <button type="button" className={`tri__btn tri__btn--defect${a === 'defect' ? ' is-on' : ''}`} onClick={() => answer(item.key, 'defect')}>Defect</button>
                    <button type="button" className={`tri__btn tri__btn--na${a === 'na' ? ' is-on' : ''}`} onClick={() => answer(item.key, 'na')}>N/A</button>
                  </div>
                  {a === 'defect' && (
                    <div className="tri__defect">
                      <input className="field field--sm" value={defectNotes[item.key] ?? ''} placeholder="What is wrong" onChange={(e) => setDefectNotes({ ...defectNotes, [item.key]: e.target.value })} />
                      <label className="button button--outline tri__photo">
                        {defectPhotos[item.key] ? 'Photo attached' : 'Photo'}
                        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setDefectPhotos({ ...defectPhotos, [item.key]: e.target.files?.[0] })} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {defects.length > 0 && (
            <div className="fitchoice">
              <p className="label">{defects.length} defect{defects.length === 1 ? '' : 's'} — can it be used today?</p>
              <div className="tri__buttons">
                <button type="button" className={`tri__btn tri__btn--ok${fit === true ? ' is-on' : ''}`} onClick={() => setFit(true)}>Fit for use</button>
                <button type="button" className={`tri__btn tri__btn--defect${fit === false ? ' is-on' : ''}`} onClick={() => setFit(false)}>Not to be used</button>
              </div>
              <p className="way-hint">Not to be used tags the machine on Plant and Home until a later prestart clears it. The defects stay open until someone closes them.</p>
            </div>
          )}

          <label className="fieldcell">
            <span className="label">Anything else</span>
            <textarea className="field" rows={2} value={notes} placeholder="Greased today, due for service Friday…" onChange={(e) => setNotes(e.target.value)} />
          </label>

          {!ready && (
            <p className="notice gap">
              Still needed before signing: {[!operator.trim() && 'the operator’s name', !answered && 'an answer for every check', !fitDecided && 'fit for use or not'].filter(Boolean).join(', ')}.
            </p>
          )}
          {error && <p className="alert">{error}</p>}
          <p className="label" style={{ marginTop: '1rem' }}>Operator&rsquo;s signature — signing saves and freezes it</p>
          <SignaturePad disabled={!ready} saving={saving} onSave={sign} />
        </>
      )}

      <Link className="button button--quiet" href={`/plant?project=${projectId}`}>All plant</Link>
    </main>
  );
}
