'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  baselines, currentBaseline, currentLookahead, fileLabel, fmtDay, lookaheadEnd, lookaheads, nextLookaheadStart, periodLabel,
  type Programme, type ProgrammeKind,
} from '@/lib/programme/model';

const BUCKET = 'programmes';

/**
 * Two shelves. The baseline: what the head contractor issued, by revision.
 * The look-aheads: one per fortnight. Upload = file first, then the row; a
 * refused row clears its file. Open = a signed link, minted when tapped.
 */
export function ProgrammeScreen({ projectId, rows, canKeep, today }: { projectId: string; rows: Programme[]; canKeep: boolean; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProgrammeKind | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [showVoided, setShowVoided] = useState(false);

  const current = useMemo(() => currentBaseline(rows), [rows]);
  const history = useMemo(() => baselines(rows), [rows]);
  const fortnights = useMemo(() => lookaheads(rows), [rows]);
  const thisFortnight = useMemo(() => currentLookahead(rows, today), [rows, today]);
  const voided = rows.filter((r) => r.voided_at != null);

  async function open(row: Programme) {
    setBusy(row.id); setError(null);
    try {
      const { data, error: err } = await createClient().storage.from(BUCKET).createSignedUrl(row.file_path, 600);
      if (err || !data?.signedUrl) throw new Error(err?.message ?? 'The file could not be opened.');
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (err) { setError(err instanceof Error ? err.message : 'The file could not be opened.'); }
    finally { setBusy(null); }
  }

  async function voidRow(row: Programme) {
    if (!voidReason.trim()) { setError('Say why it is voided.'); return; }
    setBusy(row.id); setError(null);
    try {
      const { error: err } = await createClient().from('project_programmes').update({ voided_at: new Date().toISOString(), void_reason: voidReason.trim() }).eq('id', row.id);
      if (err) throw new Error(err.message);
      setVoiding(null); setVoidReason('');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }

  const Row = ({ r, label }: { r: Programme; label?: string }) => (
    <li className={`templates__row${r.voided_at ? ' templates__row--retired' : ''}`}>
      <div className="templates__main">
        <span className="templates__title">{r.title}{label ? <span className="programme__tag"> {label}</span> : null}</span>
        <span className="templates__meta">
          {r.kind === 'baseline'
            ? `${r.revision ? `Rev ${r.revision} · ` : ''}${r.issued_on ? `issued ${fmtDay(r.issued_on)} · ` : ''}`
            : `${periodLabel(r.period_start!, r.period_end!)} · `}
          {fileLabel(r.content_type, r.size_bytes, r.file_path)} · uploaded {fmtDay(r.created_at.slice(0, 10))}
          {r.voided_at ? ` · voided: ${r.void_reason}` : ''}
        </span>
        {r.notes && <span className="templates__detail">{r.notes}</span>}
        {voiding === r.id && (
          <div className="item templates__form">
            <label className="fieldcell"><span className="label">Why it is voided</span>
              <input className="field field--sm" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Wrong file — Rev 1 uploaded twice" /></label>
            <div className="claims-actions">
              <button type="button" className="button" disabled={busy != null || !voidReason.trim()} onClick={() => void voidRow(r)}>Void it</button>
              <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => { setVoiding(null); setVoidReason(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="templates__actions">
        <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void open(r)}>{busy === r.id ? 'Opening…' : 'Open'}</button>
        {canKeep && !r.voided_at && voiding !== r.id && (
          <button type="button" className="quotebtn quotebtn--remove" disabled={busy != null} onClick={() => { setVoiding(r.id); setVoidReason(''); }}>Void</button>
        )}
      </div>
    </li>
  );

  return (
    <div className="programme">
      {error && <p className="alert">{error}</p>}

      <section className="programme__shelf">
        <h2 className="section-title">Construction programme</h2>
        {current ? (
          <p className="caption">In force: <strong>{current.title}</strong>{current.revision ? ` Rev ${current.revision}` : ''}{current.issued_on ? `, issued ${fmtDay(current.issued_on)}` : ''}.{history.length > 1 ? ` ${history.length - 1} earlier revision${history.length === 2 ? '' : 's'} kept below.` : ''}</p>
        ) : (
          <p className="claims-nil">No construction programme uploaded yet.</p>
        )}
        {canKeep && adding !== 'baseline' && (
          <button type="button" className="button button--quiet" onClick={() => { setAdding('baseline'); setError(null); }}>
            {current ? 'Upload a new revision' : 'Upload the construction programme'}
          </button>
        )}
        {adding === 'baseline' && <UploadForm kind="baseline" projectId={projectId} rows={rows} today={today} onDone={() => { setAdding(null); router.refresh(); }} onCancel={() => setAdding(null)} />}
        {history.length > 0 && (
          <ul className="plainlist templates__list">
            {history.map((r) => <Row key={r.id} r={r} label={r.id === current?.id ? 'in force' : undefined} />)}
          </ul>
        )}
      </section>

      <section className="programme__shelf">
        <h2 className="section-title">Two-week look-aheads</h2>
        {thisFortnight ? (
          <p className="caption">This fortnight: <strong>{periodLabel(thisFortnight.period_start!, thisFortnight.period_end!)}</strong>.</p>
        ) : (
          <p className="caption">No look-ahead covers today{fortnights.length ? ` — the latest ends ${fmtDay(fortnights[0].period_end)}` : ''}.</p>
        )}
        {canKeep && adding !== 'lookahead' && (
          <button type="button" className="button button--quiet" onClick={() => { setAdding('lookahead'); setError(null); }}>Upload a look-ahead</button>
        )}
        {adding === 'lookahead' && <UploadForm kind="lookahead" projectId={projectId} rows={rows} today={today} onDone={() => { setAdding(null); router.refresh(); }} onCancel={() => setAdding(null)} />}
        {fortnights.length === 0 ? (
          <p className="claims-nil">No look-aheads yet.</p>
        ) : (
          <ul className="plainlist templates__list">
            {fortnights.map((r) => <Row key={r.id} r={r} label={r.id === thisFortnight?.id ? 'this fortnight' : undefined} />)}
          </ul>
        )}
      </section>

      {voided.length > 0 && (
        <section className="programme__shelf">
          <button type="button" className="linklike" onClick={() => setShowVoided((v) => !v)}>{showVoided ? 'Hide' : 'Show'} {voided.length} voided</button>
          {showVoided && <ul className="plainlist templates__list">{voided.map((r) => <Row key={r.id} r={r} />)}</ul>}
        </section>
      )}
    </div>
  );
}

function UploadForm({ kind, projectId, rows, today, onDone, onCancel }: { kind: ProgrammeKind; projectId: string; rows: Programme[]; today: string; onDone: () => void; onCancel: () => void }) {
  const suggestedStart = useMemo(() => nextLookaheadStart(rows, today), [rows, today]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(kind === 'baseline' ? 'Construction programme' : 'Two-week look-ahead');
  const [revision, setRevision] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [start, setStart] = useState(suggestedStart);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = start ? lookaheadEnd(start) : '';

  async function save() {
    if (!file) { setError('Pick the file first.'); return; }
    if (!title.trim()) { setError('Give it a title.'); return; }
    if (kind === 'lookahead' && !start) { setError('Which fortnight does it cover?'); return; }
    setBusy(true); setError(null);
    const supabase = createClient();
    const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
    const id = crypto.randomUUID();
    const path = `${projectId}/${id}.${ext}`;
    try {
      const { error: up } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (up) throw new Error(up.message);
      const { error: ins } = await supabase.from('project_programmes').insert({
        id, project_id: projectId, kind, title: title.trim(), revision: kind === 'baseline' ? revision || null : null,
        issued_on: kind === 'baseline' ? issuedOn || null : null,
        period_start: kind === 'lookahead' ? start : null, period_end: kind === 'lookahead' ? end : null,
        notes: notes || null, file_path: path, content_type: file.type || 'application/octet-stream', size_bytes: file.size,
      });
      if (ins) {
        // The row was refused: clear the file so nothing sits in storage unreferenced.
        await supabase.storage.from(BUCKET).remove([path]);
        throw new Error(ins.message);
      }
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'The upload did not save.'); setBusy(false); }
  }

  return (
    <div className="item templates__form">
      <label className="fieldcell"><span className="label">File (PDF, spreadsheet, image or MS Project)</span>
        <input className="field field--sm" type="file" accept=".pdf,.xlsx,.xls,.csv,.mpp,image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label className="fieldcell"><span className="label">Title</span>
        <input className="field field--sm" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      {kind === 'baseline' ? (
        <div className="signin__grid">
          <label className="fieldcell"><span className="label">Revision</span>
            <input className="field field--sm" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="0" /></label>
          <label className="fieldcell"><span className="label">Issued on</span>
            <input className="field field--sm" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></label>
        </div>
      ) : (
        <div className="signin__grid">
          <label className="fieldcell"><span className="label">Fortnight starts</span>
            <input className="field field--sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">Ends</span>
            <input className="field field--sm" value={end ? fmtDay(end) : ''} readOnly /></label>
        </div>
      )}
      <label className="fieldcell"><span className="label">Notes (optional)</span>
        <input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'baseline' ? 'As issued with the LOI' : 'Slabs B1; bulk fill east'} /></label>
      {error && <p className="alert">{error}</p>}
      <div className="claims-actions">
        <button type="button" className="button" disabled={busy || !file} onClick={() => void save()}>{busy ? 'Uploading…' : 'Upload'}</button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
