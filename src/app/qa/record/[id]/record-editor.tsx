'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SignaturePad } from '@/components/signature-pad';
import { OutboxStatus } from '@/components/outbox-status';
import { runOrQueue } from '@/lib/outbox/sync';
import * as outbox from '@/lib/outbox/store';
import { compressPhoto } from '@/lib/photos/compress';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { appendQaPhotos } from '@/lib/qa/photos';
import { blanksAsGaps, gapCount, recordState, STATE_LABEL, type ItemResult, type ItemState, type RecordSignoff, type Signoff, type TemplateSection } from '@/lib/qa/model';
import type { QaRecordRow, QaTemplateRow, QaVoidEvent } from '@/lib/qa/load';

type HeaderField = { key: string; label: string; type: string; options?: string[]; default?: string; unit?: string };
type Item = { id: string; text: string; reference?: string; value_type?: string; value_label?: string; hold_point?: boolean; notice?: string };
type Section = { title: string; items: Item[] };
type Column = { key: string; label: string; type: string; options?: string[]; unit?: string };
type HoldPoint = { id: string; after_item: string; text: string; parties: string[] };
type Spec = {
  header_fields?: HeaderField[]; sections?: Section[]; columns?: Column[]; sub_register?: { heading?: string; columns: Column[] }; signoffs?: Array<Signoff & { hold_point?: string; note?: string }>;
  answer_labels?: Record<ItemState, string>; hold_points?: HoldPoint[]; lot_field?: string; register_heading?: string; comments_heading?: string; signoff_note?: string; hold_point?: boolean;
};
type Pending = { party: string; signer_name: string; blob: Blob; key: string };
type NewPhoto = { key: string; blob: Blob; type: string; extension: string; previewUrl: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The record editor (README R164): one form, filled in and signed for one lot. Every change is kept here until Save;
 * Save writes the whole record on its client-chosen id — now with signal, later without — and the database checks
 * every item, column and party against the form. A blank item is left blank until Submit, when it becomes a gap: a gap
 * is an answer, never a block. A sign-off once saved is never changed; when every required party has signed, the
 * record is frozen and this screen reads only.
 */
export function RecordEditor({ projectId, recordId, template, record, instanceId, canWrite, isOffice, trail, addedAfter, myName, today, signatureUrls, people, backTo }: {
  projectId: string; recordId: string; template: QaTemplateRow; record: QaRecordRow | null; instanceId: string | null;
  canWrite: boolean; isOffice: boolean; trail: QaVoidEvent[]; addedAfter: Record<string, { at: string; by: string | null }>; myName: string; today: string; signatureUrls: Record<string, string>; people: string[]; backTo: string;
}) {
  const router = useRouter();
  const spec = template.spec as unknown as Spec;
  const isRegister = template.kind === 'itr_register';
  const frozen = Boolean(record?.completed_at || record?.voided_at);
  const editable = canWrite && !frozen;
  // A signed record still takes photographs — added after the ones it was signed with, never removed (README R176).
  const signedPhotosOpen = canWrite && Boolean(record?.completed_at) && !record?.voided_at;
  const photosOpen = editable || signedPhotosOpen;
  const labels = spec.answer_labels ?? { ok: 'OK', gap: 'Gap', na: 'N/A' };
  const lotField = spec.lot_field ?? null;

  const [header, setHeader] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of spec.header_fields ?? []) {
      const v = record?.header?.[f.key];
      out[f.key] = v == null ? (record ? '' : (f.default ?? (f.type === 'date' && f.key.endsWith('date') ? '' : ''))) : String(v);
    }
    return out;
  });
  const [items, setItems] = useState<Record<string, { state?: ItemState; value?: string }>>(() => {
    const out: Record<string, { state?: ItemState; value?: string }> = {};
    for (const it of record?.items ?? []) out[it.item_id] = { state: it.state, value: it.value == null ? '' : String(it.value) };
    return out;
  });
  const subKeys = new Set((spec.sub_register?.columns ?? []).map((c) => c.key));
  // Each row remembers which register it is in (`_reg`), a mark the save strips: a row of the second register is one with any of its keys.
  const [rows, setRows] = useState<Array<Record<string, string>>>(() => (record?.rows ?? []).map((r) => ({ ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])), _reg: Object.keys(r).some((k) => subKeys.has(k)) ? 'sub' : 'main' })));
  const [lot, setLot] = useState(record?.lot_or_element ?? '');
  const [comments, setComments] = useState(record?.comments ?? '');
  const [pending, setPending] = useState<Pending[]>([]);
  const [photos, setPhotos] = useState<NewPhoto[]>([]);
  const [dirty, setDirty] = useState(!record);
  const [saving, setSaving] = useState(false);
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [signing, setSigning] = useState<string | null>(null);
  const [signName, setSignName] = useState('');

  const itemList = useMemo(() => (spec.sections ?? []).flatMap((s) => s.items), [spec.sections]);
  const resultsNow: ItemResult[] = itemList.filter((it) => items[it.id]?.state).map((it) => ({ item_id: it.id, state: items[it.id].state!, value: items[it.id].value || null }));
  const gaps = gapCount(resultsNow);
  const unanswered = itemList.length - resultsNow.length;
  const existing = record?.signoffs ?? [];
  const signedParty = (party: string) => existing.find((s) => s.party === party) ?? null;
  const pendingParty = (party: string) => pending.find((p) => p.party === party) ?? null;
  const state = record ? recordState(spec, { ...record, items: record.items }) : 'in_progress';
  const effectiveLot = lot.trim() || (lotField ? header[lotField]?.trim() : '') || '';

  const mark = (id: string, s: ItemState) => { if (!editable) return; setItems((m) => ({ ...m, [id]: { ...m[id], state: m[id]?.state === s ? undefined : s } })); setDirty(true); };
  const setValue = (id: string, v: string) => { setItems((m) => ({ ...m, [id]: { ...m[id], value: v } })); setDirty(true); };

  async function save(submit: boolean) {
    if (!editable) return;
    setSaving(true); setError(null); setKept(false);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id ?? null;
      const now = new Date().toISOString();
      const files = photos.map((ph) => ({ key: ph.key, path: `${projectId}/qa/${recordId}/${ph.key}.${ph.extension}`, type: ph.type, ph }));
      const photoPaths = [...(record?.photo_paths ?? []), ...files.map((f) => f.path)];
      const base: ItemResult[] = submit ? blanksAsGaps({ sections: (spec.sections ?? []) as unknown as TemplateSection[] }, resultsNow) : resultsNow;
      const itemsOut: ItemResult[] = base.map((r) => ({ item_id: r.item_id, state: r.state, ...(r.value ? { value: r.value } : {}) }));
      const headerOut: Record<string, string> = {};
      for (const [k, v] of Object.entries(header)) if (v.trim()) headerOut[k] = v.trim();
      const rowsOut = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== '_reg' && v.trim() !== '').map(([k, v]) => [k, v.trim()]))).filter((r) => Object.keys(r).length > 0);
      const sigs = pending.map((p) => ({ key: p.key, path: `${projectId}/qa/${recordId}/${p.key}.png`, p }));
      const signoffs: RecordSignoff[] = [...existing, ...sigs.map((s) => ({ party: s.p.party, signer_name: s.p.signer_name, signature_path: s.path, signed_at: now, signed_by_user_id: userId }))];
      const row = {
        id: recordId, project_id: projectId, template_id: template.id, itp_instance_id: instanceId, activity_no: null,
        lot_or_element: effectiveLot || null, header: headerOut, items: itemsOut, rows: rowsOut, comments: comments.trim() || null, signoffs, photo_paths: photoPaths,
        submitted_at: submit ? now : (record?.submitted_at ?? null), client_created_at: record?.client_created_at ?? now,
      };
      const live = async () => {
        for (const s of sigs) {
          const { error: upErr } = await supabase.storage.from('entry-photos').upload(s.path, s.p.blob, { contentType: 'image/png', upsert: false });
          if (upErr && !/already exists|duplicate/i.test(upErr.message)) throw new Error(upErr.message);
        }
        for (const f of files) {
          const { error: upErr } = await supabase.storage.from('entry-photos').upload(f.path, f.ph.blob, { contentType: f.type, upsert: false });
          if (upErr && !/already exists|duplicate/i.test(upErr.message)) throw new Error(upErr.message);
        }
        const { error: e } = await supabase.from('qa_records').upsert(row, { onConflict: 'id' });
        if (e) throw new Error(/row-level security/i.test(e.message) ? 'Your role on this job does not write QA records.' : e.message);
      };
      const queue = async () => {
        const blobs: Record<string, Blob> = {};
        for (const s of sigs) blobs[s.key] = s.p.blob;
        for (const f of files) blobs[f.key] = f.ph.blob;
        await outbox.enqueue({ kind: 'qa_record', projectId, subjectId: recordId, payload: { row, sigs: sigs.map((s) => ({ key: s.key, path: s.path })), files: files.map((f) => ({ key: f.key, path: f.path, type: f.type })) }, blobs });
      };
      const outcome = await runOrQueue(live, queue);
      if (outcome === 'sent') { setPending([]); setPhotos([]); setDirty(false); router.refresh(); }
      else { setKept(true); setDirty(false); }
    } catch (err) { setError(err instanceof Error ? err.message : 'The record did not save.'); }
    finally { setSaving(false); }
  }

  async function addPhotos(list: FileList | null) {
    if (!list || !photosOpen) return;
    for (const file of Array.from(list)) {
      try {
        const c = await compressPhoto(file);
        setPhotos((ps) => [...ps, { key: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, blob: c.blob, type: c.contentType, extension: c.extension, previewUrl: URL.createObjectURL(c.blob) }]);
        setDirty(true);
      } catch { setError('A photo could not be read.'); }
    }
  }

  // The photographs alone, onto a signed record: the files, then the append — now, or from the outbox when there is signal.
  async function savePhotosOnly() {
    if (!signedPhotosOpen || !photos.length) return;
    setSaving(true); setError(null); setKept(false);
    try {
      const supabase = createClient();
      const files = photos.map((ph) => ({ key: ph.key, path: `${projectId}/qa/${recordId}/${ph.key}.${ph.extension}`, type: ph.type, ph }));
      const live = async () => {
        for (const f of files) {
          const { error: upErr } = await supabase.storage.from('entry-photos').upload(f.path, f.ph.blob, { contentType: f.type, upsert: false });
          if (upErr && !/already exists|duplicate/i.test(upErr.message)) throw new Error(upErr.message);
        }
        await appendQaPhotos(supabase, recordId, files.map((f) => f.path));
      };
      const queue = async () => {
        const blobs: Record<string, Blob> = {};
        for (const f of files) blobs[f.key] = f.ph.blob;
        await outbox.enqueue({ kind: 'qa_record_photos', projectId, subjectId: recordId, payload: { files: files.map((f) => ({ key: f.key, path: f.path, type: f.type })) }, blobs });
      };
      const outcome = await runOrQueue(live, queue);
      if (outcome === 'sent') { setPhotos([]); setDirty(false); router.refresh(); }
      else { setKept(true); setDirty(false); }
    } catch (err) { setError(err instanceof Error ? err.message : 'The photographs did not save.'); }
    finally { setSaving(false); }
  }

  async function voidRecord() {
    if (!record || !voidReason.trim()) return;
    setSaving(true); setError(null);
    try {
      const { data, error: e } = await createClient().from('qa_records').update({ voided_at: new Date().toISOString(), void_reason: voidReason.trim() }).eq('id', recordId).select('id');
      if (e) throw new Error(e.message);
      if (!data?.length) throw new Error('That could not be voided from this account.');
      setVoiding(false); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setSaving(false); }
  }

  // The office puts back a record voided by mistake (README R175): the database restores it exactly as it stood and
  // keeps the void and the restore on the record's trail.
  async function restoreRecord() {
    if (!record || !restoreReason.trim()) return;
    setSaving(true); setError(null);
    try {
      const { error: e } = await createClient().rpc('restore_qa_record', { p_record: recordId, p_reason: restoreReason.trim() });
      if (e) throw new Error(e.message);
      setRestoring(false); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setSaving(false); }
  }

  const field = (f: HeaderField) => {
    const v = header[f.key] ?? '';
    const set = (x: string) => { setHeader((h) => ({ ...h, [f.key]: x })); setDirty(true); };
    if (f.type === 'select') return <select className="field field--sm" value={v} disabled={!editable} onChange={(e) => set(e.target.value)}><option value="">—</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    if (f.type === 'date') return <input className="field field--sm" type="date" value={v} disabled={!editable} onChange={(e) => set(e.target.value)} />;
    if (f.type === 'number') return <input className="field field--sm" inputMode="decimal" value={v} disabled={!editable} onChange={(e) => set(e.target.value)} />;
    if (f.type === 'multiline') return <textarea className="field field--sm" rows={2} value={v} disabled={!editable} onChange={(e) => set(e.target.value)} />;
    return <input className="field field--sm" value={v} disabled={!editable} onChange={(e) => set(e.target.value)} />;
  };

  const SignBlock = ({ party, def }: { party: string; def: (Signoff & { note?: string }) | undefined }) => {
    const done = signedParty(party);
    const pend = pendingParty(party);
    const open = signing === party;
    return (
      <div className={`qa-sign${done || pend ? ' qa-sign--done' : ''}`}>
        <div className="qa-sign__head">
          <span className="qa-sign__party">{party}{def?.is_release ? <span className="caption"> · releases the hold point</span> : null}{def && !def.required ? <span className="caption"> · if applicable{def.note ? ` — ${def.note}` : ''}</span> : null}</span>
          {done ? <span className="caption">{done.signer_name} · {fmtPerthDate(done.signed_at)}</span>
            : pend ? <span className="qa-pending">{pend.signer_name} · signed, not saved yet</span>
              : editable && !open ? <button type="button" className="quotebtn" onClick={() => { setSigning(party); setSignName(def?.kind === 'internal' ? myName : ''); }}>Sign</button>
                : !editable ? <span className="caption">Not signed</span> : null}
        </div>
        {done && signatureUrls[done.signature_path] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={signatureUrls[done.signature_path]} alt={`${party} signature`} /> : null}
        {open && editable && (
          <div className="qa-sign__form">
            <label className="fieldcell"><span className="label">Name</span>
              <input className="field field--sm" list="qa-people" value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Who is signing" /></label>
            <SignaturePad onSave={(blob) => { if (!signName.trim()) { setError('Name first, then sign.'); return; } setPending((p) => [...p.filter((x) => x.party !== party), { party, signer_name: signName.trim(), blob, key: `sig-${slug(party)}-${Date.now()}` }]); setSigning(null); setDirty(true); setError(null); }} />
            <button type="button" className="quotebtn" onClick={() => setSigning(null)}>Cancel</button>
          </div>
        )}
      </div>
    );
  };
  const signoffDefs = spec.signoffs ?? [];
  const holdPoints = spec.hold_points ?? [];
  const inHold = new Set(holdPoints.flatMap((h) => h.parties));
  const looseSignoffs = signoffDefs.filter((s) => !inHold.has(s.party));

  return (
    <div className="qa-edit">
      <datalist id="qa-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="qa-edit__bar">
        <div className="qa-edit__state">
          <strong>{record ? STATE_LABEL[state] : 'New record'}{effectiveLot ? ` · ${effectiveLot}` : ''}</strong>
          <span className="caption">
            {frozen ? (record?.voided_at ? `Voided: ${record.void_reason ?? ''}` : `Signed by every required party ${fmtPerthDate(record!.completed_at!)} — frozen`)
              : `${resultsNow.length} of ${itemList.length} answered${gaps ? ` · ${gaps} gap${gaps === 1 ? '' : 's'}` : ''}${unanswered && record?.submitted_at ? ` · ${unanswered} blank` : ''}${dirty ? ' · not saved' : kept ? ' · kept on this phone, sends with signal' : ''}`}
          </span>
        </div>
        <div className="claims-actions" style={{ margin: 0 }}>
          {editable && <button type="button" className={`button${dirty || pending.length ? '' : ' button--quiet'}`} disabled={saving} onClick={() => void save(false)}>{saving ? 'Saving…' : 'Save'}</button>}
          {editable && !isRegister && <button type="button" className="button button--quiet" disabled={saving} onClick={() => void save(true)} title="Saves, and records every blank item as a gap">Submit</button>}
          {record && <a className="button button--quiet" href={`/api/qa/record/${recordId}/pdf`} target="_blank" rel="noopener">PDF</a>}
          <Link className="button button--quiet" href={backTo}>Back</Link>
        </div>
      </div>
      <OutboxStatus />
      {error && <p className="alert">{error}</p>}
      {record?.voided_at && <p className="notice gap">This record was voided{record.void_reason ? `: ${record.void_reason}` : ''}. It stays readable; raise a new one if the work is to be recorded{isOffice ? ', or restore it below if it was voided by mistake' : ''}.</p>}
      {trail.length > 0 && (
        <p className="caption">
          {trail.map((e) => `${e.action === 'voided' ? 'Voided' : 'Restored'} ${fmtPerthDate(e.at)}${e.by ? ` by ${e.by}` : ''}: ${e.reason}`).join(' · ')}
        </p>
      )}

      {(spec.header_fields ?? []).length > 0 && (
        <section className="qa-section">
          <p className="label">Record details</p>
          <div className="qa-header">
            {(spec.header_fields ?? []).map((f) => <label key={f.key} className="fieldcell"><span className="label">{f.label}</span>{field(f)}</label>)}
          </div>
          {!lotField && <label className="fieldcell" style={{ marginTop: '0.5rem' }}><span className="label">Lot or element</span><input className="field field--sm" value={lot} disabled={!editable} onChange={(e) => { setLot(e.target.value); setDirty(true); }} /></label>}
        </section>
      )}

      {!isRegister && (spec.sections ?? []).map((s) => (
        <section key={s.title} className="qa-section">
          <p className="label">{s.title}</p>
          {s.items.map((it) => {
            const r = items[it.id];
            const hps = holdPoints.filter((h) => h.after_item === it.id);
            const hp = hps[0];
            return (
              <div key={it.id}>
                <div className="qa-item">
                  <span className="qa-item__no mono">{it.id}</span>
                  <span className="qa-item__text">{it.text}{it.reference && it.reference !== '—' ? <span className="qa-item__ref mono">{it.reference}</span> : null}{it.notice && !hp ? <span className="qa-item__notice">{it.notice}</span> : null}</span>
                  <span className="qa-answers" role="group" aria-label={`Item ${it.id}`}>
                    {(['ok', 'gap', 'na'] as ItemState[]).map((st) => (
                      <button key={st} type="button" className={`qa-answer qa-answer--${st}${r?.state === st ? ' is-on' : ''}`} disabled={!editable} aria-pressed={r?.state === st} onClick={() => mark(it.id, st)}>{labels[st]}</button>
                    ))}
                  </span>
                  {(it.value_type ?? 'none') !== 'none' && (r?.state || r?.value) && (
                    <div className="qa-item__value">
                      <input className="field field--sm" placeholder={it.value_label ?? 'Comment'} value={r?.value ?? ''} disabled={!editable} onChange={(e) => setValue(it.id, e.target.value)} />
                    </div>
                  )}
                </div>
                {hps.map((h) => (
                  <div key={h.id} className="qa-hold">
                    <p className="qa-hold__text">{h.id} · {h.text}</p>
                    <div className="qa-signs">
                      {h.parties.map((party) => <SignBlock key={party} party={party} def={signoffDefs.find((d) => d.party === party)} />)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      ))}

      {([...(isRegister ? [['main', spec.register_heading ?? 'Register', spec.columns ?? []]] : []), ...(spec.sub_register ? [['sub', spec.sub_register.heading ?? 'Register', spec.sub_register.columns]] : [])] as Array<[string, string, Column[]]>).map(([reg, heading, cols]) => {
        const mine = rows.map((row, i) => [row, i] as const).filter(([row]) => (row._reg ?? 'main') === reg);
        return (
          <section key={reg} className="qa-section">
            <p className="label">{heading}</p>
            <div className="qa-register">
              <table>
                <thead><tr><th>#</th>{cols.map((c) => <th key={c.key}>{c.label}</th>)}{editable && <th />}</tr></thead>
                <tbody>
                  {mine.map(([row, i], n) => (
                    <tr key={i}>
                      <td className="mono">{n + 1}</td>
                      {cols.map((c) => (
                        <td key={c.key}>
                          {c.type === 'select'
                            ? <select className="field field--sm" value={row[c.key] ?? ''} disabled={!editable} onChange={(e) => { setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x))); setDirty(true); }}><option value="">—</option>{(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                            : <input className="field field--sm" type={c.type === 'date' ? 'date' : 'text'} inputMode={c.type === 'number' ? 'decimal' : undefined} value={row[c.key] ?? ''} disabled={!editable} onChange={(e) => { setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x))); setDirty(true); }} />}
                        </td>
                      ))}
                      {editable && <td><button type="button" className="quotebtn quotebtn--remove" onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setDirty(true); }}>Remove</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && <button type="button" className="quotebtn" style={{ marginTop: '0.5rem' }} onClick={() => { setRows((rs) => [...rs, { _reg: reg }]); setDirty(true); }}>+ Add a row</button>}
            {mine.length === 0 && <p className="caption">Nothing recorded yet.</p>}
          </section>
        );
      })}

      <section className="qa-section">
        <p className="label">Photographs · {(record?.photo_paths.length ?? 0) + photos.length}</p>
        <div className="qa-item__photos">
          {(record?.photo_paths ?? []).map((p) => signatureUrls[p] ? /* eslint-disable-next-line @next/next/no-img-element */ <img key={p} className="qa-photo" src={signatureUrls[p]} alt="" title={addedAfter[p] ? `Added after sign-off ${fmtPerthDate(addedAfter[p].at)}${addedAfter[p].by ? ` by ${addedAfter[p].by}` : ''}` : undefined} /> : <span key={p} className="qa-photo qa-photo--pending" />)}
          {photos.map((ph) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={ph.key} className="qa-photo qa-photo--new" src={ph.previewUrl} alt="" title="Not saved yet" />)}
          {photosOpen && (
            <label className="qa-photo__add">
              <span>+ Photos</span>
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { const l = e.target.files; void addPhotos(l); e.target.value = ''; }} />
            </label>
          )}
          {!photosOpen && (record?.photo_paths.length ?? 0) === 0 && <span className="caption">None.</span>}
        </div>
        {Object.keys(addedAfter).length > 0 && (
          <p className="caption">{(record?.photo_paths ?? []).filter((p) => addedAfter[p]).length} added after sign-off: {[...new Set(Object.values(addedAfter).map((a) => `${fmtPerthDate(a.at)}${a.by ? ` by ${a.by}` : ''}`))].join(' · ')}. The rest were there when it was signed.</p>
        )}
        {photos.length > 0 && editable && <p className="caption">{photos.length} new photo{photos.length === 1 ? '' : 's'} — saved with the record when you press Save.</p>}
        {photos.length > 0 && signedPhotosOpen && (
          <div className="dw-rates__form">
            <button type="button" className="button" disabled={saving} onClick={() => void savePhotosOnly()}>{saving ? 'Saving…' : `Add ${photos.length} photo${photos.length === 1 ? '' : 's'} to the signed record`}</button>
            <button type="button" className="quotebtn" onClick={() => { setPhotos([]); setDirty(false); }}>Discard</button>
            <span className="caption">The record stays as signed; these are marked as added after sign-off, with the date and your name.</span>
          </div>
        )}
        {kept && signedPhotosOpen && <p className="caption">Kept on this phone, sends with signal.</p>}
      </section>

      <section className="qa-section">
        <p className="label">{spec.comments_heading ?? 'Comments'}</p>
        <textarea className="field" rows={3} value={comments} disabled={!editable} onChange={(e) => { setComments(e.target.value); setDirty(true); }} />
      </section>

      {looseSignoffs.length > 0 && (
        <section className="qa-section">
          <p className="label">Sign-off</p>
          {spec.signoff_note && <p className="caption">{spec.signoff_note}</p>}
          <div className="qa-signs">{looseSignoffs.map((s) => <SignBlock key={s.party} party={s.party} def={s} />)}</div>
        </section>
      )}

      {record && !record.voided_at && canWrite && (
        <div className="qa-section">
          {!voiding ? <button type="button" className="quotebtn quotebtn--remove" onClick={() => setVoiding(true)}>Void this record</button> : (
            <div className="dw-rates__form">
              <input className="field field--sm" placeholder="Why it is voided" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              <button type="button" className="button button--quiet" disabled={saving || !voidReason.trim()} onClick={() => void voidRecord()}>Void it</button>
              <button type="button" className="quotebtn" onClick={() => setVoiding(false)}>Keep</button>
            </div>
          )}
          <p className="caption">A voided record stays on the file, readable, with its reason. Nothing is deleted.</p>
        </div>
      )}
      {record?.voided_at && isOffice && (
        <div className="qa-section">
          {!restoring ? <button type="button" className="quotebtn" onClick={() => setRestoring(true)}>Restore this record</button> : (
            <div className="dw-rates__form">
              <input className="field field--sm" placeholder="Why it is restored" value={restoreReason} onChange={(e) => setRestoreReason(e.target.value)} />
              <button type="button" className="button button--quiet" disabled={saving || !restoreReason.trim()} onClick={() => void restoreRecord()}>Restore it</button>
              <button type="button" className="quotebtn" onClick={() => setRestoring(false)}>Leave it</button>
            </div>
          )}
          <p className="caption">Restored exactly as it stood — its answers, signatures and photographs unchanged. The void and the restore both stay on its trail.</p>
        </div>
      )}
      <p className="caption">Yes, No or N/A on every line; No is a gap and the office reads it. Submit records every unanswered line as a gap. {today ? `Today is ${fmtPerthDate(today)}.` : ''}</p>
    </div>
  );
}
