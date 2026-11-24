'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SignaturePad } from '@/components/signature-pad';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate } from '@/lib/pdf/dates';
import { approvalOf, declarationText, signaturePath, type DayworkSignoff, type SignedLine } from '@/lib/dayworks/signoff';
import { dayBlockers, dayLines, dayPeriodLabel, type DayworkDraft } from '@/lib/dayworks/day-approval';
import { SignedFileLink } from '@/app/dayworks/signoff-block';

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
const sum = (lines: readonly SignedLine[]) => Math.round(lines.reduce((t, l) => t + (l.hours ?? 0), 0) * 100) / 100;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const SELECT = 'id, period_from, period_to, period_label, items, hours, hours_not_recorded, photos, signed_by_name, signed_by_position, signed_on, file_path, note, signed_how, signature_path, declaration, signed_at, lines';

/**
 * The head contractor signs for the day's dayworks on the day's own diary (README R192) — while they are standing
 * there, not a week later on a sheet. It is the SAME record as a signature on the Dayworks schedule (R125): a
 * `dayworks_signoffs` row holding the lines it was given for, sent through the same outbox kind, so the schedule,
 * the sign-off sheet and the costed claim all see it without knowing where it was given.
 *
 * Offered once the tab is filled in — every item with its works and its hours. What is signed for is kept as it read
 * at that moment: an item reworded or re-houred afterwards no longer matches and waits for a signature again, here
 * and on the schedule, which is exactly what a subcontractor needs told.
 */
export function DayworksApproval({ projectId, entryDate, items, clientName, canRecord, beforeSign }: {
  projectId: string;
  entryDate: string;
  items: readonly DayworkDraft[];
  clientName: string;
  canRecord: boolean;
  /** Sends the day's draft first, so what is signed for is what is kept. Best effort — the signature does not wait on it. */
  beforeSign?: () => Promise<void>;
}) {
  const [signoffs, setSignoffs] = useState<DayworkSignoff[]>([]);
  const [loaded, setLoaded] = useState<'loading' | 'ok' | 'failed'>('loading');
  // Signatures given on this screen that have not come back from the database yet — sent a moment ago, or kept on the phone.
  const [here, setHere] = useState<DayworkSignoff[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const queued = usePending('dayworks_approval', projectId, 'project');

  const load = useCallback(async () => {
    try {
      // A signature that covers this day cannot be dated before it (the database refuses one), so that is the whole search.
      const { data, error: e } = await createClient().from('dayworks_signoffs').select(SELECT).eq('project_id', projectId).gte('signed_on', entryDate).order('signed_on');
      if (e) throw e;
      const rows = ((data ?? []) as unknown as DayworkSignoff[]).filter((s) => (s.lines ?? []).some((l) => l.date === entryDate));
      setSignoffs(rows);
      setHere((h) => h.filter((x) => !rows.some((r) => r.id === x.id)));
      setLoaded('ok');
    } catch { setLoaded('failed'); }
  }, [projectId, entryDate]);
  useEffect(() => { void load(); }, [load]);

  const lines = useMemo(() => dayLines(entryDate, items), [entryDate, items]);
  const blockers = useMemo(() => dayBlockers(items), [items]);
  const all = useMemo(() => [...signoffs, ...here], [signoffs, here]);
  const approval = useMemo(() => approvalOf(lines, all), [lines, all]);
  const awaiting = useMemo(() => lines.filter((_, i) => !approval.by[i]), [lines, approval]);
  const declaration = declarationText(clientName, awaiting.length);

  async function sign(signature: Blob) {
    setError(null); setDone(null);
    if (!name.trim()) { setError('Print the name of the person signing, above the signature.'); return; }
    if (awaiting.length === 0) { setError('There is nothing waiting for a signature.'); return; }
    setBusy(true);
    try {
      await beforeSign?.().catch(() => undefined);
      const id = outbox.newId();
      const path = signaturePath(projectId, id);
      const now = new Date().toISOString();
      const row = {
        id, project_id: projectId,
        period_from: entryDate, period_to: entryDate, period_label: dayPeriodLabel(entryDate),
        // What they signed for, as it reads now — never recomputed.
        items: awaiting.length, hours: sum(awaiting), hours_not_recorded: awaiting.filter((l) => l.hours == null).length,
        lines: awaiting,
        signed_by_name: name.trim(), signed_by_position: position.trim() || null,
        // The database dates it; this is only what the column needs to be sent.
        signed_on: now.slice(0, 10), signed_on_device_at: now,
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
      // Shown as signed at once, from what was just given; the database's own row replaces it when it is read back.
      setHere((h) => [...h, { id, period_from: entryDate, period_to: entryDate, period_label: row.period_label, items: row.items, hours: row.hours, hours_not_recorded: row.hours_not_recorded, photos: 0,
        signed_by_name: row.signed_by_name, signed_by_position: row.signed_by_position, signed_on: entryDate, file_path: null, note: row.note, signed_how: 'on_screen', signature_path: outcome === 'sent' ? path : null, declaration, signed_at: now, lines: awaiting }]);
      setOpen(false); setName(''); setPosition(''); setNote('');
      if (outcome === 'sent') { setDone(`Signed by ${row.signed_by_name} for ${clientName}: ${what} approved.`); void load(); }
      // Kept on the phone: say so and leave the page as it is (README R78).
      else setDone(`Signed by ${row.signed_by_name}: ${what}. There is no signal, so the signature is kept on this phone and sends itself when there is.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
      setError(/row-level security/i.test(message ?? '') ? 'Your role on this job does not record the client’s approval.' : message ?? 'The signature did not save. Ask them to sign again.');
    } finally { setBusy(false); }
  }

  if (items.length === 0) return null;
  const waiting = `${plural(approval.awaiting, 'item', 'items')}, ${hrs(approval.awaitingHours)} hours`;

  return (
    <section className="dws-block dws-block--day" id="dayworks-approval">
      <p className="label">Approval by {clientName}</p>
      {queued.length > 0 && <p className="notice gap">{plural(queued.length, 'signature is', 'signatures are')} kept on this phone, waiting for signal.</p>}
      {loaded === 'failed' && <p className="caption">Could not check for signatures already given — there may be no signal. One given now is still kept.</p>}
      {approval.state === 'approved' && (
        <p className="notice"><strong>Approved.</strong> {cap(clientName)} has signed for every daywork on this day: {plural(approval.approved, 'item', 'items')}, {hrs(approval.approvedHours)} hours.</p>
      )}
      {approval.state === 'part' && (
        <p className="notice gap"><strong>Partly approved.</strong> {cap(clientName)} has signed for {plural(approval.approved, 'item', 'items')}, {hrs(approval.approvedHours)} hours. Still waiting for a signature: {waiting}.</p>
      )}
      {approval.state === 'awaiting' && blockers.length === 0 && (
        <p className="notice gap"><strong>Not approved yet.</strong> Waiting for {clientName} to sign: {waiting}.</p>
      )}
      {/* Whatever else is true: an item with no description is not a line yet, so it is in no count above — it is named here. */}
      {blockers.length > 0 && (
        <p className="notice gap">{cap(clientName)} can sign once the dayworks are filled in: {blockers.join(' ')}</p>
      )}
      {done && <p className="notice" role="status">{done}</p>}
      {error && !open && <p className="alert" role="alert">{error}</p>}

      {canRecord && !open && approval.awaiting > 0 && blockers.length === 0 && (
        <div className="claims-actions">
          <button type="button" className="button" onClick={() => { setOpen(true); setError(null); setDone(null); }}>{cap(clientName)} signs here</button>
        </div>
      )}
      {!canRecord && approval.awaiting > 0 && blockers.length === 0 && <p className="caption">A supervisor, PM or admin on this job hands the phone over for the signature.</p>}

      {canRecord && open && (
        <div className="item dws-sign">
          <p className="label">For signature by {clientName} · {fmtDate(entryDate)}</p>
          <div className="claims-tablewrap">
            <table className="claims-table dws-sign__lines">
              <thead><tr><th>#</th><th>Works completed</th><th>Labour · plant · materials</th><th className="n">Hours</th></tr></thead>
              <tbody>
                {awaiting.map((l, i) => (
                  <tr key={`${l.works}-${i}`}>
                    <td className="mono">{i + 1}</td>
                    <td>{l.works}</td>
                    <td>{[l.labour, l.plant, l.materials].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="n mono">{l.hours == null ? 'Not recorded' : hrs(l.hours)}</td>
                  </tr>
                ))}
                <tr className="dw-total"><td colSpan={3}><strong>Total: {plural(awaiting.length, 'item', 'items')}</strong></td><td className="n mono"><strong>{hrs(sum(awaiting))}</strong></td></tr>
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
          <SignaturePad saving={busy} onSave={(blob) => void sign(blob)} />
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="claims-actions">
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {all.length > 0 && (
        <ul className="plainlist">
          {all.map((s) => (
            <li key={s.id}>
              <span className="mono">{fmtDate(s.signed_on)}</span> · {s.signed_by_name}{s.signed_by_position ? `, ${s.signed_by_position}` : ''} · {plural((s.lines ?? []).filter((l) => l.date === entryDate).length, 'item', 'items')} of this day
              {' · '}{s.signed_how === 'on_screen' ? 'signed on the screen' : 'signed on paper'}
              {s.signature_path ? <> · <SignedFileLink path={s.signature_path} label="Show the signature" /></> : null}
              {s.file_path ? <> · <SignedFileLink path={s.file_path} label="Open the signed sheet" /></> : null}
              {s.note ? <span className="vr-note">{s.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="caption">
        A signature covers the items as they read when it was given. Change an item’s works or hours afterwards and it waits for a signature again.
        The same approval shows on the Dayworks schedule once the day is signed.
      </p>
    </section>
  );
}
