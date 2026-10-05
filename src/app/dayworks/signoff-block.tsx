'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SignaturePad } from '@/components/signature-pad';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { fmtDate } from '@/lib/pdf/dates';
import { declarationText, signaturePath, signoffPath, type DayworkSignoff, type SignedLine } from '@/lib/dayworks/signoff';

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
const sum = (lines: readonly SignedLine[]) => Math.round(lines.reduce((t, l) => t + (l.hours ?? 0), 0) * 100) / 100;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export interface ApprovalSummary {
  state: 'nothing' | 'approved' | 'part' | 'awaiting';
  approved: number;
  approvedHours: number;
  awaiting: number;
  awaitingHours: number;
  awaitingNoHours: number;
}

/**
 * The client's approval of this period's dayworks (README R125, R86). A daywork is approved when the head contractor
 * has signed for its line — here on the screen, or on a paper sheet recorded afterwards. What a signature covered is
 * kept as the lines read at that moment, so a correction made later shows as waiting again rather than passing as
 * approved.
 *
 * Signing on the screen goes through the outbox: the signature is the one thing on this page that cannot be asked
 * for twice, so with no signal it is kept on the phone and sent when there is one.
 */
export function SignoffBlock({
  projectId, period, periodLabel, summary, awaiting, allLines, hoursNotRecorded, signoffs, canRecord, clientName, pendingCorrectionDays,
}: {
  projectId: string;
  period: { from: string | null; to: string | null };
  periodLabel: string;
  summary: ApprovalSummary;
  /** The lines still waiting for a signature, in schedule order — what an on-screen signature covers. */
  awaiting: SignedLine[];
  /** Every line on the period's sheet — what a paper sheet carried. */
  allLines: SignedLine[];
  hoursNotRecorded: number;
  signoffs: DayworkSignoff[];
  canRecord: boolean;
  clientName: string;
  pendingCorrectionDays: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'closed' | 'screen' | 'paper'>('closed');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [kept, setKept] = useState(false);

  const declaration = declarationText(clientName, awaiting.length);
  const where = periodLabel.toLowerCase() === 'whole job' ? 'the whole job' : periodLabel;

  /** The head contractor's person signs on this screen for the lines still waiting. */
  async function signOnScreen(signature: Blob) {
    setError(null); setDone(null);
    if (!name.trim()) { setError('Print the name of the person signing, above the signature.'); return; }
    setBusy(true);
    try {
      const id = outbox.newId();
      const path = signaturePath(projectId, id);
      const row = {
        id, project_id: projectId,
        period_from: period.from, period_to: period.to, period_label: periodLabel,
        // What they signed for, as it reads now — never recomputed.
        items: awaiting.length, hours: sum(awaiting), hours_not_recorded: awaiting.filter((l) => l.hours == null).length,
        lines: awaiting,
        signed_by_name: name.trim(), signed_by_position: position.trim() || null,
        // The database dates it; this is only what the column needs to be sent.
        signed_on: new Date().toISOString().slice(0, 10), signed_on_device_at: new Date().toISOString(),
        signature_path: path, declaration,
        note: note.trim() || null,
      };
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('dayworks-signoffs').upload(path, signature, { contentType: 'image/png', upsert: false });
        if (upErr && !/exists|duplicate/i.test(upErr.message)) throw upErr;
        const { error: rowErr } = await supabase.from('dayworks_signoffs').insert(row);
        if (rowErr) {
          // A refused row leaves no signature behind it; a dropped connection keeps both for the queue.
          if (rowErr.code) await supabase.storage.from('dayworks-signoffs').remove([path]).catch(() => undefined);
          throw rowErr;
        }
      };
      const queue = () => outbox.enqueue({ kind: 'dayworks_approval', projectId, subjectId: id, payload: { path, row }, blobs: { signature } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      const what = `${plural(awaiting.length, 'item', 'items')}, ${hrs(sum(awaiting))} hours`;
      setMode('closed'); setName(''); setPosition(''); setNote('');
      if (outcome === 'sent') { setDone(`Signed by ${row.signed_by_name} for ${clientName}: ${what} approved.`); router.refresh(); }
      // Kept on the phone: say so and leave the page as it is — a refresh with no signal would blank it (README R78).
      else { setKept(true); setDone(`Signed by ${row.signed_by_name}: ${what}. There is no signal, so the signature is kept on this phone and sends itself when there is.`); }
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
      setError(/row-level security/i.test(message ?? '') ? 'Your role on this job does not record the client’s approval.' : message ?? 'The signature did not save. Ask them to sign again.');
    } finally {
      setBusy(false);
    }
  }

  /** A sheet signed on paper, recorded afterwards — the file first, then the row, the file cleared if the row is refused. */
  async function recordPaper() {
    setError(null); setDone(null);
    if (!name.trim()) { setError('Who signed it?'); return; }
    if (!signedOn) { setError('What date did they sign it?'); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      let path: string | null = null;
      if (file) {
        path = signoffPath(projectId, id, file.name);
        const { error: upErr } = await supabase.storage.from('dayworks-signoffs').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (upErr) throw new Error(`The signed sheet did not upload: ${upErr.message}`);
      }
      const { error: rowErr } = await supabase.from('dayworks_signoffs').insert({
        id, project_id: projectId,
        period_from: period.from, period_to: period.to, period_label: periodLabel,
        items: allLines.length, hours: sum(allLines), hours_not_recorded: hoursNotRecorded, lines: allLines,
        signed_by_name: name.trim(), signed_by_position: position.trim() || null,
        signed_on: signedOn, file_path: path, note: note.trim() || null,
      });
      if (rowErr) {
        if (path) await supabase.storage.from('dayworks-signoffs').remove([path]).catch(() => undefined);
        throw new Error(rowErr.message);
      }
      setMode('closed'); setName(''); setPosition(''); setSignedOn(''); setNote(''); setFile(null);
      setDone('Recorded.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not record.');
    } finally {
      setBusy(false);
    }
  }

  const waiting = `${plural(summary.awaiting, 'item', 'items')}, ${hrs(summary.awaitingHours)} hours${summary.awaitingNoHours ? ` (${summary.awaitingNoHours} with no hours recorded)` : ''}`;

  return (
    <section className="dws-block" id="approval">
      <p className="label">Approval by {clientName}</p>
      {kept && <p className="notice gap">A signature is kept on this phone and has not been sent yet. It will show here once it has.</p>}
      {summary.state === 'nothing' && <p className="caption">No dayworks on signed days in {where}, so there is nothing to approve.</p>}
      {summary.state === 'approved' && (
        <p className="notice"><strong>Approved.</strong> {cap(clientName)} has signed for every daywork in {where}: {plural(summary.approved, 'item', 'items')}, {hrs(summary.approvedHours)} hours.</p>
      )}
      {summary.state === 'part' && (
        <p className="notice gap"><strong>Partly approved.</strong> {cap(clientName)} has signed for {plural(summary.approved, 'item', 'items')}, {hrs(summary.approvedHours)} hours. Still waiting for a signature: {waiting}.</p>
      )}
      {summary.state === 'awaiting' && (
        <p className="notice gap"><strong>Not approved yet.</strong> Waiting for {clientName} to sign: {waiting}.</p>
      )}
      {done && <p className="notice" role="status">{done}</p>}
      {error && mode === 'closed' && <p className="alert" role="alert">{error}</p>}

      {canRecord && mode === 'closed' && summary.awaiting > 0 && !kept && (
        <div className="claims-actions">
          <button type="button" className="button" onClick={() => { setMode('screen'); setError(null); setDone(null); }}>{cap(clientName)} signs here</button>
          <button type="button" className="button button--quiet" onClick={() => { setMode('paper'); setError(null); setDone(null); }}>Record a sheet signed on paper</button>
        </div>
      )}

      {canRecord && mode === 'screen' && (
        <div className="item dws-sign">
          <p className="label">For signature by {clientName} · {periodLabel}</p>
          {pendingCorrectionDays > 0 ? (
            <p className="alert">
              {plural(pendingCorrectionDays, 'day has a correction', 'days have corrections')} written but not signed. Sign {pendingCorrectionDays === 1 ? 'it' : 'them'} first,
              or {clientName} would be signing for rows that are about to change.
            </p>
          ) : (
            <>
              <div className="claims-tablewrap">
                <table className="claims-table dws-sign__lines">
                  <thead><tr><th>#</th><th>Date</th><th>Works completed</th><th>Labour · plant · materials</th><th className="n">Hours</th></tr></thead>
                  <tbody>
                    {awaiting.map((l, i) => (
                      <tr key={`${l.date}-${i}`}>
                        <td className="mono">{i + 1}</td>
                        <td className="mono">{fmtDate(l.date)}</td>
                        <td>{l.works}</td>
                        <td>{[l.labour, l.plant, l.materials].filter(Boolean).join(' · ') || '—'}</td>
                        <td className={`n mono${l.hours == null ? ' claims-flag' : ''}`}>{l.hours == null ? 'Not recorded' : hrs(l.hours)}</td>
                      </tr>
                    ))}
                    <tr className="dw-total"><td colSpan={4}><strong>Total: {plural(awaiting.length, 'item', 'items')}</strong></td><td className="n mono"><strong>{hrs(sum(awaiting))}</strong></td></tr>
                  </tbody>
                </table>
              </div>
              <p className="dws-sign__dec">{declaration}</p>
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">Name of the person signing</span>
                  <input className="field field--sm" value={name} autoComplete="off" placeholder="Their name" onChange={(e) => setName(e.target.value)} /></label>
                <label className="fieldcell"><span className="label">Their position at {clientName}</span>
                  <input className="field field--sm" value={position} autoComplete="off" placeholder="Site manager" onChange={(e) => setPosition(e.target.value)} /></label>
              </div>
              <label className="fieldcell"><span className="label">Anything they want noted · optional</span>
                <input className="field field--sm" value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <p className="label">Signature</p>
              <SignaturePad saving={busy} onSave={(blob) => void signOnScreen(blob)} />
            </>
          )}
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="claims-actions">
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setMode('closed'); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {canRecord && mode === 'paper' && (
        <div className="item">
          <p className="caption">
            Recording what {clientName} signed on paper for {periodLabel} — {plural(allLines.length, 'item', 'items')}, {hrs(sum(allLines))} hours.
            The lines are kept as they read now, so a later correction cannot pass as something they put their name to.
          </p>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Who signed it</span>
              <input className="field field--sm" value={name} placeholder="Their name" onChange={(e) => setName(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Their position</span>
              <input className="field field--sm" value={position} placeholder="Site manager" onChange={(e) => setPosition(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Date signed</span>
              <input className="field field--sm" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} /></label>
          </div>
          <label className="fieldcell"><span className="label">The signed sheet</span>
            <input className="field field--sm" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label className="fieldcell"><span className="label">Note</span>
            <input className="field field--sm" value={note} placeholder="Anything they said when they signed" onChange={(e) => setNote(e.target.value)} /></label>
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy} onClick={() => void recordPaper()}>{busy ? 'Recording…' : 'Record it'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setMode('closed'); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {signoffs.length > 0 && (
        <details className="dws-block__past">
          <summary className="label">Every signature on this job ({signoffs.length})</summary>
          <ul className="plainlist">
            {signoffs.map((s) => (
              <li key={s.id}>
                <span className="mono">{fmtDate(s.signed_on)}</span> · {s.period_label} · {plural(s.items, 'item', 'items')}, {hrs(s.hours)} h · {s.signed_by_name}{s.signed_by_position ? `, ${s.signed_by_position}` : ''}
                {' · '}{s.signed_how === 'on_screen' ? 'signed on the screen' : 'signed on paper'}
                {s.signature_path ? <> · <SignedFileLink path={s.signature_path} label="Show the signature" /></> : null}
                {s.file_path ? <> · <SignedFileLink path={s.file_path} label="Open the signed sheet" /></> : null}
                {s.note ? <span className="vr-note">{s.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The bucket is private, so the link is minted when it is asked for. */
function SignedFileLink({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  if (url) return <a href={url} target="_blank" rel="noopener">{label}</a>;
  return (
    <button
      type="button"
      className="quotebtn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const supabase = createClient();
        const { data } = await supabase.storage.from('dayworks-signoffs').createSignedUrl(path, 300);
        if (data?.signedUrl) { setUrl(data.signedUrl); window.open(data.signedUrl, '_blank', 'noopener'); }
        setBusy(false);
      }}
    >
      {busy ? 'Opening…' : label}
    </button>
  );
}
