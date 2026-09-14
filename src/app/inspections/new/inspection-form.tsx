'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { compressPhoto } from '@/lib/photos/compress';
import { SignaturePad } from '@/components/signature-pad';
import {
  BUILT_IN_TEMPLATES, KIND_LABEL, RESULT_LABEL, builtInItems, type InspectionKind, type ItemResult, type TemplateItem,
} from '@/lib/inspections/model';

export interface TemplateChoice { id: string | null; name: string; kind: InspectionKind; items: TemplateItem[] }
interface Props { projectId: string; userId: string; today: string; inspector: string; templates: TemplateChoice[] }
interface Photo { blob: Blob; type: string; ext: string; preview: string }

/**
 * The whole inspection on one screen: pick a template, walk the items, note
 * and photograph the issues, sign. Sent as one thing — queued if there is no
 * signal — and frozen by the database the moment the signature lands.
 */
export function InspectionForm({ projectId, userId, today, inspector, templates }: Props) {
  const router = useRouter();
  const choices: TemplateChoice[] = [
    ...templates,
    ...BUILT_IN_TEMPLATES.filter((b) => !templates.some((t) => t.name.toLowerCase() === b.name.toLowerCase()))
      .map((b) => ({ id: null, name: b.name, kind: b.kind, items: builtInItems(b) })),
  ];
  const [template, setTemplate] = useState<TemplateChoice | null>(null);
  const [date, setDate] = useState(today);
  const [area, setArea] = useState('');
  const [who, setWho] = useState(inspector);
  const [results, setResults] = useState<Record<string, ItemResult | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = template ? template.items.filter((i) => results[i.key]).length : 0;
  const ready = Boolean(template) && answered > 0 && who.trim().length > 0;

  async function addPhoto(key: string, files: FileList | null) {
    if (!files) return;
    try {
      const next: Photo[] = [];
      for (const f of Array.from(files)) { const c = await compressPhoto(f); next.push({ blob: c.blob, type: c.contentType, ext: c.extension, preview: URL.createObjectURL(c.blob) }); }
      setPhotos((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...next] }));
    } catch (err) {
      setError(err instanceof Error ? `Photo could not be read: ${err.message}` : 'Photo could not be read.');
    }
  }

  async function submit(sig: Blob) {
    if (!template) return;
    if (!ready) { setError('Answer at least one item and put your name to it.'); return; }
    setBusy(true);
    setError(null);
    const id = outbox.newId();
    const at = new Date().toISOString();
    const sigPath = `${projectId}/inspection/${id}/sig-${outbox.newId()}.png`;
    const photoPaths: Array<{ key: string; path: string; type: string; blob: Blob }> = [];
    const items = template.items.map((i) => {
      const paths = (photos[i.key] ?? []).map((p) => { const path = `${projectId}/inspection/${id}/${outbox.newId()}.${p.ext}`; photoPaths.push({ key: `${i.key}-${photoPaths.length}`, path, type: p.type, blob: p.blob }); return path; });
      return { key: i.key, label: i.label, result: results[i.key] ?? null, note: (notes[i.key] ?? '').trim() || null, photo_urls: paths };
    });
    const row = {
      template_id: template.id, template_name: template.name, kind: template.kind, inspection_date: date, area: area.trim() || null,
      inspector_name: who.trim(), items, summary: summary.trim() || null, conducted_by: userId,
    };
    try {
      const live = async () => {
        const supabase = createClient();
        for (const ph of photoPaths) {
          const { error: e } = await supabase.storage.from('entry-photos').upload(ph.path, ph.blob, { contentType: ph.type, upsert: false });
          if (e) throw new Error(e.message);
        }
        // The signature lands before the row, so a refused upload leaves nothing half-made.
        const { error: sigErr } = await supabase.storage.from('entry-photos').upload(sigPath, sig, { contentType: 'image/png', upsert: false });
        if (sigErr) throw new Error(sigErr.message);
        const { error: rowErr } = await supabase.from('inspections').insert({ id, project_id: projectId, ...row });
        if (rowErr) throw new Error(rowErr.message);
        const { data, error: doneErr } = await supabase.from('inspections').update({ signature_path: sigPath, completed_on_device_at: at }).eq('id', id).select('id');
        if (doneErr) throw new Error(doneErr.message);
        if (!data || data.length === 0) throw new Error('The inspection was saved but could not be signed from this account.');
      };
      const queue = () => outbox.enqueue({
        kind: 'inspection_submit', projectId, subjectId: id,
        payload: { row, at, sigPath, photoPaths: photoPaths.map(({ key, path, type }) => ({ key, path, type })) },
        blobs: { signature: sig, ...Object.fromEntries(photoPaths.map((p) => [p.key, p.blob])) },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      router.push(outcome === 'sent' ? `/inspections/${id}` : `/inspections?project=${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The inspection did not save.');
      setBusy(false);
    }
  }

  if (!template) {
    return (
      <div className="inspection-pick">
        <p className="label">Which checklist</p>
        {choices.map((c) => (
          <button key={c.id ?? c.name} type="button" className="prestart-row inspection-pick__row" onClick={() => setTemplate(c)}>
            <span><strong>{c.name}</strong><br /><span className="caption">{KIND_LABEL[c.kind]} · {c.items.length} items{c.id ? '' : ' · standard'}</span></span>
            <span>Start</span>
          </button>
        ))}
        <p className="caption">A standard checklist can be copied and edited under Templates.</p>
      </div>
    );
  }

  return (
    <div className="inspection-form">
      <p className="page-subtitle"><strong>{template.name}</strong> · {KIND_LABEL[template.kind]}</p>
      <div className="signin__grid">
        <label className="fieldcell fieldcell--narrow"><span className="label">Date</span>
          <input className="field field--sm" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Area</span>
          <input className="field field--sm" value={area} placeholder="Whole site, ch 0–400, north yard…" onChange={(e) => setArea(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">Inspected by</span>
        <input className="field field--sm" value={who} onChange={(e) => setWho(e.target.value)} /></label>

      <ul className="tri-list">
        {template.items.map((i) => {
          const r = results[i.key];
          return (
            <li key={i.key} className={`tri${r === 'ok' ? ' tri--ok' : r === 'issue' ? ' tri--defect' : r === 'na' ? ' tri--na' : ''}`}>
              <p className="tri__label">{i.label}</p>
              <div className="tri__buttons">
                {(['ok', 'issue', 'na'] as ItemResult[]).map((v) => (
                  <button key={v} type="button" className={`tri__btn${r === v ? ` tri__btn--${v === 'issue' ? 'defect' : v}` : ''}`} onClick={() => setResults({ ...results, [i.key]: v })}>{RESULT_LABEL[v]}</button>
                ))}
              </div>
              {r === 'issue' && (
                <div className="tri__defect">
                  <textarea className="field field--sm" rows={2} placeholder="What is wrong, and where" value={notes[i.key] ?? ''} onChange={(e) => setNotes({ ...notes, [i.key]: e.target.value })} />
                  <div className="photo-add-pair">
                    <label className="button button--quiet" style={{ marginTop: 0 }}>Photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addPhoto(i.key, e.target.files)} /></label>
                    <label className="button button--quiet" style={{ marginTop: 0 }}>From phone<input type="file" accept="image/*" multiple hidden onChange={(e) => void addPhoto(i.key, e.target.files)} /></label>
                  </div>
                  {(photos[i.key] ?? []).length > 0 && (
                    <div className="photos__grid report-form__photos">
                      {(photos[i.key] ?? []).map((p, n) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <figure key={n}><img src={p.preview} alt="" /></figure>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <label className="fieldcell"><span className="label">Overall</span>
        <textarea className="field field--sm" rows={2} value={summary} placeholder="Optional — anything the items do not cover" onChange={(e) => setSummary(e.target.value)} /></label>
      <p className="caption">{answered} of {template.items.length} answered{answered < template.items.length ? ' — unanswered items print as not checked' : ''}.</p>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="sigslot item">
        <p className="label">Sign to finish</p>
        <SignaturePad disabled={!ready || busy} saving={busy} onSave={submit} />
      </div>
      <button type="button" className="linklike" disabled={busy} onClick={() => setTemplate(null)}>Choose a different checklist</button>
    </div>
  );
}
