'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { inductionRows, notInducted, type Induction } from '@/lib/crew/inductions';

/**
 * Who is inducted onto this job, and the form for recording one by hand
 * (README R88): a name — from the list, or typed for a subbie or a visitor on
 * no roster — the day it happened, and what was covered. The date can be any
 * day up to today; the database refuses one after it. One induction per
 * person per job, so recording someone twice says when they already were.
 */
export function InductionsBlock({
  projectId,
  userId,
  people,
  inductions,
  canRecord,
  today,
}: {
  projectId: string;
  userId: string;
  people: string[];
  inductions: Induction[];
  canRecord: boolean;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const rows = inductionRows(people, inductions);
  const waiting = notInducted(people, inductions);

  async function record() {
    setError(null);
    setSaved(null);
    const who = name.replace(/\s+/g, ' ').trim();
    if (!who) { setError('Who was inducted?'); return; }
    if (!date) { setError('What day was it?'); return; }
    if (date > today) { setError('Record an induction once it has happened.'); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: insErr } = await supabase
        .from('crew_inductions')
        .insert({ project_id: projectId, person_name: who, inducted_on: date, notes: notes.trim() || null, inducted_by: userId });
      if (insErr) {
        if (/crew_inductions_one_per_person_idx|duplicate key/i.test(insErr.message)) {
          const had = inductions.find((i) => i.person_name.toLowerCase() === who.toLowerCase());
          throw new Error(`${who} is already inducted on this job${had ? `, on ${fmtDate(had.inducted_on)}` : ''}.`);
        }
        throw new Error(insErr.message);
      }
      setSaved(`${who} inducted ${date === today ? 'today' : `on ${fmtDate(date)}`}.`);
      setName(''); setNotes(''); setDate(today);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inductions">
      <p className="label">Inductions</p>
      <p className="caption">
        Who has had the site induction for this job. The crew prestart and the gate mark a sign-on from anyone not on
        this list. Recorded on the day by a sign-on, or here afterwards.
      </p>

      {saved && <p className="notice">{saved}</p>}

      {canRecord && !open && (
        <button type="button" className="button button--quiet" onClick={() => { setOpen(true); setSaved(null); }}>
          Record an induction
        </button>
      )}

      {canRecord && open && (
        <div className="item">
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Who</span>
              <input className="field field--sm" list="induct-people" value={name} placeholder="Name — pick, or type a visitor’s" onChange={(e) => setName(e.target.value)} />
              <datalist id="induct-people">{waiting.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            <label className="fieldcell"><span className="label">The day it happened</span>
              <input className="field field--sm" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <label className="fieldcell"><span className="label">What was covered</span>
            <input className="field field--sm" value={notes} placeholder="Site rules, muster point, the head contractor’s induction card…" onChange={(e) => setNotes(e.target.value)} /></label>
          {error && <p className="alert">{error}</p>}
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy} onClick={record}>{busy ? 'Recording…' : 'Record it'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="caption">Nobody on this job yet.</p>
      ) : (
        <ul className="plainlist inductions__list">
          {rows.map(({ name: who, induction }) => (
            <li key={who} className={`inductions__row${induction ? '' : ' inductions__row--waiting'}`}>
              <span className="inductions__name">{who}</span>
              {induction ? (
                <span className="inductions__meta">
                  inducted <span className="mono">{fmtDate(induction.inducted_on)}</span>
                  {induction.recorded_by ? ` · by ${induction.recorded_by}` : ''}
                  {induction.notes ? <span className="vr-note">{induction.notes}</span> : null}
                </span>
              ) : (
                <span className="inductions__meta inductions__meta--waiting">not inducted here</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
