'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DAY_LABELS, dm, dmy, fmtHours, hoursFromClocks, normName, weekDays, weekOf, type OfficeTime } from '@/lib/timesheets/model';

const PLACES = ['Office', 'Yard', 'Workshop', 'Training', 'Travel'];

/**
 * Time the office adds to the timesheet (README R122): a day with no diary — the office, the yard, a training
 * room. One line per person; several people at the same clocks are added together. A line is never edited:
 * a wrong one is removed with its reason and the right one added. The database does the hours' arithmetic.
 */
export function AddTime({ orgId, projectId, monday, today, people, added }: {
  orgId: string;
  projectId: string;
  monday: string;
  today: string;
  /** Names to offer: the week's sheet, the crews, the members. Any other name can be typed. */
  people: string[];
  added: OfficeTime[];
}) {
  const router = useRouter();
  const days = weekDays(monday);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [typing, setTyping] = useState('');
  const [date, setDate] = useState(days.includes(today) ? today : '');
  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');
  const [breakMins, setBreakMins] = useState('0');
  const [hours, setHours] = useState('');
  const [place, setPlace] = useState('Office');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const clocks = start !== '' || finish !== '';
  const brk = breakMins.trim() === '' ? 0 : Number(breakMins);
  const fromClocks = hoursFromClocks(start, finish, Number.isFinite(brk) ? brk : 0);
  const clean = (n: string) => n.replace(/\s+/g, ' ').trim();
  const take = (raw: string) => {
    const n = clean(raw);
    if (!n) return;
    setNames((list) => (list.some((x) => normName(x) === normName(n)) ? list : [...list, n]));
    setTyping('');
  };
  const everyone = () => {
    const t = clean(typing);
    return t && !names.some((x) => normName(x) === normName(t)) ? [...names, t] : names;
  };

  function problem(): string | null {
    if (everyone().length === 0) return 'Name at least one person.';
    if (!date) return 'Pick the day.';
    if (date > today) return 'Time cannot be added for a day in the future.';
    if (clocks) {
      if (!start || !finish) return 'Give both the start and the finish, or neither.';
      if (!Number.isInteger(brk) || brk < 0 || brk > 600) return 'Break: whole minutes, 0 to 600.';
      if (fromClocks == null) return finish <= start ? 'The finish must be after the start. For a shift past midnight, clear the clocks and give the hours.' : 'The break is as long as the time worked.';
    } else {
      const h = Number(hours);
      if (hours.trim() === '' || !Number.isFinite(h) || h <= 0 || h > 24) return 'Give the start and finish, or the hours (up to 24).';
    }
    if (!clean(place)) return 'Say where the time was worked.';
    return null;
  }

  async function save() {
    const bad = problem();
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null); setSaved(null);
    const who = everyone();
    try {
      const rows = who.map((person_name) => ({
        org_id: orgId, person_name, work_date: date,
        start_time: clocks ? start : null, finish_time: clocks ? finish : null, break_mins: clocks ? brk : 0,
        hours: clocks ? fromClocks : Number(hours), place: clean(place), note: note.trim() || null,
      }));
      const { error: err } = await createClient().from('timesheet_entries').insert(rows);
      if (err) throw new Error(/duplicate key/i.test(err.message) ? 'One of those lines is already on the sheet for that day. Nothing was added.' : /row-level security/i.test(err.message) ? 'Only a company admin adds time to the timesheet.' : err.message);
      setSaved(`Added ${who.length === 1 ? who[0] : `${who.length} people`} on ${dmy(date)}.`);
      setNames([]); setTyping(''); setNote('');
      const week = weekOf(date);
      if (week !== monday) router.push(`/timesheets?project=${projectId}&week=${week}`);
      else router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!reason.trim()) { setError('Say why the line is being removed.'); return; }
    setBusy(true); setError(null); setSaved(null);
    try {
      const { data, error: err } = await createClient().from('timesheet_entries').update({ void_reason: reason.trim() }).eq('id', id).select('id');
      if (err) throw new Error(err.message);
      if (!data || data.length === 0) throw new Error('Only a company admin removes a line.');
      setRemoving(null); setReason('');
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  const live = added.filter((a) => !a.voidedAt);
  const gone = added.filter((a) => a.voidedAt);
  const line = (a: OfficeTime) => {
    const i = days.indexOf(a.date);
    return `${i >= 0 ? `${DAY_LABELS[i]} ` : ''}${dm(a.date)} · ${a.personName} · ${a.start && a.finish ? `${a.start}–${a.finish}${a.breakMins ? ` less ${a.breakMins} min` : ''} · ` : ''}${fmtHours(a.hours)} h · ${a.place}`;
  };

  return (
    <section className="combine-names addtime">
      <p className="label">Time added by the office{live.length ? ` · ${live.length}` : ''}</p>
      <p className="caption">For a day with no diary — the office, the yard, training. It goes on the sheet marked with where it was worked, and it is paid like any other hour. Time on a job belongs in that job’s diary.</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {saved && <p className="notice" role="status">{saved}</p>}

      {live.length > 0 && (
        <ul className="plainlist combine-names__list">
          {live.map((a) => (
            <li key={a.id} className="addtime__line">
              <span>
                <strong>{line(a)}</strong>
                <span className="caption">{a.note ? ` · ${a.note}` : ''}{a.addedBy ? ` · added by ${a.addedBy}` : ''}</span>
              </span>
              {removing === a.id ? (
                <span className="addtime__remove">
                  <input className="field field--sm" placeholder="Why is it being removed?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for removing the line" />
                  <button type="button" className="quotebtn quotebtn--remove" disabled={busy} onClick={() => void remove(a.id)}>Remove line</button>
                  <button type="button" className="quotebtn" disabled={busy} onClick={() => { setRemoving(null); setReason(''); setError(null); }}>Keep</button>
                </span>
              ) : (
                <button type="button" className="quotebtn" disabled={busy} onClick={() => { setRemoving(a.id); setReason(''); setError(null); }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {gone.length > 0 && (
        <p className="caption">Removed this week: {gone.map((a) => `${line(a)} — ${a.voidReason}`).join('; ')}.</p>
      )}

      {!open ? (
        <div className="regs__actions"><button type="button" className="button" onClick={() => setOpen(true)}>Add time</button></div>
      ) : (
        <div className="item addtime__form">
          <div className="fieldcell">
            <span className="label">Who</span>
            {names.length > 0 && (
              <span className="addtime__people">
                {names.map((n) => (
                  <span key={n} className="addtime__person">{n}
                    <button type="button" aria-label={`Take ${n} off`} onClick={() => setNames((l) => l.filter((x) => x !== n))}>×</button>
                  </span>
                ))}
              </span>
            )}
            <span className="addtime__who">
              <input className="field field--sm" list="addtime-people" placeholder={names.length ? 'Another person…' : 'Name…'} value={typing}
                onChange={(e) => { const v = e.target.value; if (people.some((p) => p === v)) take(v); else setTyping(v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); take(typing); } }} aria-label="Person" />
              <button type="button" className="quotebtn" disabled={!clean(typing)} onClick={() => take(typing)}>Add person</button>
            </span>
            <datalist id="addtime-people">{people.filter((p) => !names.some((n) => normName(n) === normName(p))).map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div className="regs__fields">
            <label className="fieldcell regs__field"><span className="label">Day</span>
              <input className="field field--sm" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="fieldcell regs__field"><span className="label">Start</span>
              <input className="field field--sm" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="fieldcell regs__field"><span className="label">Finish</span>
              <input className="field field--sm" type="time" value={finish} onChange={(e) => setFinish(e.target.value)} /></label>
            <label className="fieldcell regs__field"><span className="label">Break, minutes</span>
              <input className="field field--sm" inputMode="numeric" value={breakMins} onChange={(e) => setBreakMins(e.target.value)} disabled={!clocks} /></label>
            <label className="fieldcell regs__field"><span className="label">Hours</span>
              {clocks
                ? <span className="field field--sm addtime__hours" aria-live="polite">{fromClocks == null ? '—' : `${fmtHours(fromClocks)} h`}</span>
                : <input className="field field--sm" inputMode="decimal" placeholder="No clocks? Type the hours" value={hours} onChange={(e) => setHours(e.target.value)} />}</label>
            <label className="fieldcell regs__field"><span className="label">Where</span>
              <input className="field field--sm" list="addtime-places" maxLength={40} value={place} onChange={(e) => setPlace(e.target.value)} />
              <datalist id="addtime-places">{PLACES.map((p) => <option key={p} value={p} />)}</datalist></label>
            <label className="fieldcell regs__field regs__field--wide"><span className="label">Note · optional</span>
              <input className="field field--sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What they were doing" /></label>
          </div>
          <div className="regs__actions">
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : everyone().length > 1 ? `Add ${everyone().length} people` : 'Add to the timesheet'}</button>
            <button type="button" className="quotebtn" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
