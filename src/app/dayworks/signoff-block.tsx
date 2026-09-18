'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { driftFrom, driftText, signoffFor, signoffPath, type DayworkSignoff } from '@/lib/dayworks/signoff';

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/**
 * The client's signature on this period's sheet: what is already recorded, and
 * the form for recording one when it comes back (README R86).
 *
 * The file is uploaded first and the row written straight after, with the file
 * removed if the row is refused — the same order as an issued procedure, so a
 * recorded signature never points at a file that is not there.
 */
export function SignoffBlock({
  projectId,
  period,
  periodLabel,
  now,
  signoffs,
  canRecord,
  clientName,
}: {
  projectId: string;
  period: { from: string | null; to: string | null };
  periodLabel: string;
  now: { items: number; hours: number; hoursNotRecorded: number };
  signoffs: DayworkSignoff[];
  canRecord: boolean;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here = signoffFor(signoffs, period);
  const drift = here ? driftFrom(here, now) : null;

  async function record() {
    setError(null);
    if (!name.trim()) { setError('Who signed it?'); return; }
    if (!signedOn) { setError('What date did they sign it?'); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      let path: string | null = null;
      if (file) {
        path = signoffPath(projectId, id, file.name);
        const { error: upErr } = await supabase.storage
          .from('dayworks-signoffs')
          .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (upErr) throw new Error(`The signed sheet did not upload: ${upErr.message}`);
      }
      const { error: rowErr } = await supabase.from('dayworks_signoffs').insert({
        id,
        project_id: projectId,
        period_from: period.from,
        period_to: period.to,
        period_label: periodLabel,
        // What the sheet said when they signed it, not what it says later.
        items: now.items,
        hours: now.hours,
        hours_not_recorded: now.hoursNotRecorded,
        signed_by_name: name.trim(),
        signed_by_position: position.trim() || null,
        signed_on: signedOn,
        file_path: path,
        note: note.trim() || null,
      });
      if (rowErr) {
        if (path) await supabase.storage.from('dayworks-signoffs').remove([path]).catch(() => undefined);
        throw new Error(rowErr.message);
      }
      setOpen(false);
      setName(''); setPosition(''); setSignedOn(''); setNote(''); setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dws-block">
      {here ? (
        <div className={`notice${drift ? ' gap' : ''}`}>
          <p>
            <strong>Signed off by {here.signed_by_name}</strong>
            {here.signed_by_position ? ` (${here.signed_by_position})` : ''} on {fmtDate(here.signed_on)} —{' '}
            {here.items} item{here.items === 1 ? '' : 's'}, {hrs(here.hours)} hours.
          </p>
          {drift && (
            <p>
              The schedule has changed since: it now reads {driftText(drift)}. What they signed is what is
              recorded above; send a fresh sheet if the difference matters.
            </p>
          )}
          {here.file_path && <SignedFileLink path={here.file_path} />}
        </div>
      ) : (
        <p className="caption">
          {clientName} has not signed off {periodLabel.toLowerCase() === 'whole job' ? 'the whole job' : periodLabel} yet.
        </p>
      )}

      {canRecord && !open && (
        <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>
          {here ? 'Record another signature' : 'Record the client’s signature'}
        </button>
      )}

      {canRecord && open && (
        <div className="item">
          <p className="caption">
            Recording what {clientName} signed for {periodLabel} — {now.items} item{now.items === 1 ? '' : 's'},{' '}
            {hrs(now.hours)} hours. Those figures are kept as they are now, so a later correction cannot change
            what they put their name to.
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
          {error && <p className="alert">{error}</p>}
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy} onClick={record}>{busy ? 'Recording…' : 'Record it'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {signoffs.length > 0 && (
        <details className="dws-block__past">
          <summary className="label">Every sheet signed on this job ({signoffs.length})</summary>
          <ul className="plainlist">
            {signoffs.map((s) => (
              <li key={s.id}>
                <span className="mono">{fmtDate(s.signed_on)}</span> · {s.period_label} · {s.items} item{s.items === 1 ? '' : 's'},{' '}
                {hrs(s.hours)} h · {s.signed_by_name}{s.signed_by_position ? `, ${s.signed_by_position}` : ''}
                {s.file_path ? <> · <SignedFileLink path={s.file_path} /></> : null}
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
function SignedFileLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="quotebtn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const supabase = createClient();
        const { data } = await supabase.storage.from('dayworks-signoffs').createSignedUrl(path, 300);
        if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
        setBusy(false);
      }}
    >
      {busy ? 'Opening…' : 'Open the signed sheet'}
    </button>
  );
}
