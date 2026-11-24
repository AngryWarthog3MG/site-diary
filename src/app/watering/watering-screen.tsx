'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Fold } from '@/components/fold';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import * as outbox from '@/lib/outbox/store';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { saveWateringDay, type WateringDayPayload } from '@/lib/watering/save';
import {
  DAY_LONG, DAY_SHORT, METHODS, METHOD_LABEL, METHOD_SHORT, NOTES_MAX, areaHours, cellState, closeProblems, dm, dmy, entryKey, fmtHours, isBlank, lineGaps,
  readAreaNames, readHours, readTemp, shownAreas, weekDays, weekOver,
  type Method, type WateringArea, type WateringClose, type WateringDay, type WateringEntry, type WateringLine,
} from '@/lib/watering/model';

type LineDraft = { method: Method | ''; hours: string; supp_method: Method | ''; supp_hours: string; notes: string };
const BLANK: LineDraft = { method: '', hours: '', supp_method: '', supp_hours: '', notes: '' };
const str = (n: number | null) => (n == null ? '' : String(n));

/** The draft as the model reads it. Hours that do not parse count as not stated here; the save refuses them by name. */
function toLine(d: LineDraft): WateringLine {
  return {
    method: d.method || null, hours: d.method ? readHours(d.hours).value : null,
    supp_method: d.supp_method || null, supp_hours: d.supp_method ? readHours(d.supp_hours).value : null,
    notes: d.notes.trim() || null,
  };
}

/**
 * The watering register's working screen (README R190). A day at a time: the maximum temperature, then each area with
 * its watering, its supplementary watering and a note. Save writes the whole day — with signal now, without it from
 * the outbox — and saving is what says the day was recorded, so an empty area on it reads "not watered". The grid
 * underneath is the week as it will print. A closed week reads only.
 */
export function WateringScreen({ projectId, monday, today, areas, entries, days, closed, bureau, canRecord, canClose, office }: {
  projectId: string; monday: string; today: string; areas: WateringArea[]; entries: WateringEntry[]; days: WateringDay[]; closed: WateringClose | null;
  bureau: Record<string, number>; canRecord: boolean; canClose: boolean; office: boolean;
}) {
  const router = useRouter();
  const week = useMemo(() => weekDays(monday), [monday]);
  const shown = useMemo(() => shownAreas(areas, entries), [areas, entries]);
  const queued = usePending('watering_day', projectId, 'project');

  const [day, setDay] = useState(() => (week.includes(today) ? today : week[0]));
  const [lines, setLines] = useState<Record<string, LineDraft>>(() => {
    const out: Record<string, LineDraft> = {};
    for (const e of entries) out[entryKey(e.area_id, e.day)] = { method: e.method ?? '', hours: str(e.hours), supp_method: e.supp_method ?? '', supp_hours: str(e.supp_hours), notes: e.notes ?? '' };
    return out;
  });
  const [temps, setTemps] = useState<Record<string, string>>(() => Object.fromEntries(days.map((d) => [d.day, str(d.temp_max)])));
  // Days this screen has saved since it opened — recorded, whatever the page was loaded with.
  const [savedHere, setSavedHere] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'kept' | 'bad'; text: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [newAreas, setNewAreas] = useState('');

  const serverKeys = useMemo(() => new Set(entries.map((e) => entryKey(e.area_id, e.day))), [entries]);
  const recorded = useMemo(() => new Set([...days.map((d) => d.day), ...entries.map((e) => e.day), ...savedHere]), [days, entries, savedHere]);
  const lineOf = (areaId: string, d: string) => lines[entryKey(areaId, d)] ?? BLANK;
  const editable = canRecord && !closed && day <= today;
  const i = week.indexOf(day);
  const dayRow = days.find((d) => d.day === day) ?? null;

  const touch = (d: string) => { setDirty((s) => new Set(s).add(d)); setMsg(null); };
  const setLine = (areaId: string, patch: Partial<LineDraft>) => {
    setLines((m) => {
      const cur = m[entryKey(areaId, day)] ?? BLANK;
      const next = { ...cur, ...patch };
      // Hours never stand without a method: clearing the method clears its hours.
      if (!next.method) next.hours = '';
      if (!next.supp_method) next.supp_hours = '';
      return { ...m, [entryKey(areaId, day)]: next };
    });
    touch(day);
  };

  // What this day will not save with, by name.
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!readTemp(temps[day] ?? '').ok) out.push('The maximum temperature is a number between -10 and 60.');
    for (const a of shown) {
      const l = lines[entryKey(a.id, day)] ?? BLANK;
      if (l.method && !readHours(l.hours).ok) out.push(`${a.name}: hours are over 0 and at most 24.`);
      if (l.supp_method && !readHours(l.supp_hours).ok) out.push(`${a.name} supplementary: hours are over 0 and at most 24.`);
      if (l.notes.length > NOTES_MAX) out.push(`${a.name}: the note is at most ${NOTES_MAX} characters.`);
    }
    return out;
  }, [day, lines, temps, shown]);
  const dayGaps = (d: string) => shown.reduce((n, a) => n + lineGaps(toLine(lineOf(a.id, d))).length, 0);

  async function saveDay() {
    if (!editable || busy) return;
    if (problems.length) { setMsg({ kind: 'bad', text: problems[0] }); return; }
    setBusy(true); setMsg(null);
    const d = day;
    // Every active area with something on it, and every line the register already holds for the day — so clearing one is written too.
    const out = shown.filter((a) => a.active).map((a) => ({ area_id: a.id, line: toLine(lineOf(a.id, d)) }))
      .filter(({ area_id, line }) => !isBlank(line) || serverKeys.has(entryKey(area_id, d)))
      .map(({ area_id, line }) => ({ area_id, ...line }));
    const payload: WateringDayPayload = { projectId, day: d, temp: readTemp(temps[d] ?? '').value, lines: out };
    try {
      const outcome = await runOrQueue(
        () => saveWateringDay(createClient(), payload),
        () => outbox.enqueue({ kind: 'watering_day', projectId, subjectId: `${projectId}:${d}`, payload: payload as unknown as Record<string, unknown> }).then(() => undefined),
      );
      setDirty((s) => { const n = new Set(s); n.delete(d); return n; });
      setSavedHere((s) => new Set(s).add(d));
      const label = `${DAY_LONG[week.indexOf(d)]} ${dm(d)}`;
      // A save kept on the phone never refreshes the page (README R78): offline it would blank the screen.
      if (outcome === 'sent') { setMsg({ kind: 'ok', text: `${label} saved.` }); router.refresh(); }
      else setMsg({ kind: 'kept', text: `${label} kept on this phone; it sends when there is signal.` });
    } catch (err) { setMsg({ kind: 'bad', text: err instanceof Error ? err.message : 'That did not save.' }); }
    finally { setBusy(false); }
  }

  // The week as the drafts stand — what the grid draws and what closing is judged on.
  const draftEntries: WateringEntry[] = useMemo(() => {
    const out: WateringEntry[] = [];
    for (const a of shown) for (const d of week) { const l = lines[entryKey(a.id, d)]; if (l) out.push({ area_id: a.id, day: d, ...toLine(l) }); }
    return out;
  }, [shown, week, lines]);
  const nameOf = (id: string) => shown.find((a) => a.id === id)?.name ?? 'An area';
  const over = weekOver(monday, today);
  const cannotClose = [...closeProblems(monday, today, draftEntries, nameOf), ...(dirty.size ? ['Save the days you have changed first.'] : []), ...(queued.length ? ['A day is still waiting on this phone for signal.'] : [])];
  const unrecorded = week.filter((d) => d <= today && !recorded.has(d));

  async function closeWeek() {
    if (!canClose || closed || cannotClose.length) return;
    setBusy(true); setMsg(null);
    try {
      const { error } = await createClient().from('watering_weeks').insert({ project_id: projectId, week_start: monday });
      if (error) throw new Error(/row-level security/i.test(error.message) ? 'Your role on this job does not close the week.' : error.message);
      setConfirmClose(false); router.refresh();
    } catch (err) { setMsg({ kind: 'bad', text: err instanceof Error ? err.message : 'The week did not close.' }); }
    finally { setBusy(false); }
  }

  async function addAreas() {
    const names = readAreaNames(newAreas, areas.map((a) => a.name));
    if (!names.length) { setMsg({ kind: 'bad', text: 'Type an area the job does not already have, one to a line.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const top = areas.reduce((n, a) => Math.max(n, a.sort_order), 0);
      const { error } = await createClient().from('watering_areas').insert(names.map((name, k) => ({ project_id: projectId, name, sort_order: top + k + 1 })));
      if (error) throw new Error(/row-level security/i.test(error.message) ? 'The office keeps the areas — a PM or an admin.' : /watering_areas_name_once/.test(error.message) ? 'The job already has an area of that name.' : error.message);
      setNewAreas(''); router.refresh();
    } catch (err) { setMsg({ kind: 'bad', text: err instanceof Error ? err.message : 'The areas did not save.' }); }
    finally { setBusy(false); }
  }
  async function setActive(area: WateringArea, active: boolean) {
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await createClient().from('watering_areas').update({ active }).eq('id', area.id).select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error('The office keeps the areas — a PM or an admin.');
      router.refresh();
    } catch (err) { setMsg({ kind: 'bad', text: err instanceof Error ? err.message : 'That did not save.' }); }
    finally { setBusy(false); }
  }

  const methodSelect = (value: Method | '', blank: string, label: string, onChange: (v: Method | '') => void) => (
    <select className="field field--sm" aria-label={label} value={value} disabled={!editable} onChange={(e) => onChange(e.target.value as Method | '')}>
      <option value="">{blank}</option>
      {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
    </select>
  );
  const hoursInput = (value: string, enabled: boolean, label: string, onChange: (v: string) => void) => (
    <input className="field field--sm" type="number" inputMode="decimal" step="0.25" min="0" max="24" placeholder="hours" aria-label={label} value={value} disabled={!editable || !enabled} onChange={(e) => onChange(e.target.value)} />
  );
  const part = (method: Method | null, hours: number | null) => <>{METHOD_SHORT[method!]} {hours != null ? `${fmtHours(hours)} h` : <span className="wtr__amber">hours?</span>}</>;

  return (
    <>
      {queued.length > 0 && <p className="notice gap">{queued.length} day{queued.length === 1 ? '' : 's'} of the watering register kept on this phone, waiting for signal.</p>}
      {closed && <p className="notice">This week was closed {fmtPerthDate(closed.closed_at)}{closed.closed_by_name ? ` by ${closed.closed_by_name}` : ''}. Nothing in it changes.</p>}

      {shown.length > 0 && (
        <>
          <div className="wtr__days" role="tablist" aria-label="Day">
            {week.map((d, k) => {
              const ahead = d > today;
              const gaps = dayGaps(d);
              const sub = ahead ? 'to come' : dirty.has(d) ? 'not saved' : !recorded.has(d) ? 'not recorded' : gaps ? `${gaps} hours?` : 'recorded';
              return (
                <button key={d} type="button" role="tab" aria-selected={d === day} disabled={ahead}
                  className={`wtr__day${d === day ? ' wtr__day--on' : ''}${!ahead && (dirty.has(d) || !recorded.has(d) || gaps) ? ' wtr__day--gap' : ''}`} onClick={() => { setDay(d); setMsg(null); }}>
                  {DAY_SHORT[k]} {dm(d)}<small>{sub}</small>
                </button>
              );
            })}
          </div>

          <section className="wtr__card">
            <div className="wtr__head">
              <h2>{DAY_LONG[i]} {dmy(day)}</h2>
              <label className="wtr__temp">
                <span className="label">Max temperature °C</span>
                <input className="field field--sm" type="number" inputMode="decimal" step="0.1" min="-10" max="60" placeholder="34.5" value={temps[day] ?? ''} disabled={!editable}
                  onChange={(e) => { const v = e.target.value; setTemps((t) => ({ ...t, [day]: v })); touch(day); }} />
              </label>
            </div>
            <p className="caption">
              {bureau[day] != null ? <>The Bureau’s maximum for the day: {bureau[day].toFixed(1)} °C — a prompt, not the record.{' '}
                {editable && (temps[day] ?? '') === '' && <button type="button" className="quotebtn" onClick={() => { setTemps((t) => ({ ...t, [day]: bureau[day].toFixed(1) })); touch(day); }}>Use it</button>}</>
                : 'No Bureau reading for this day yet — type the maximum read on site.'}
              {dayRow?.recorded_at ? ` Recorded ${fmtPerthDate(dayRow.recorded_at)}${dayRow.recorded_by_name ? ` by ${dayRow.recorded_by_name}` : ''}.` : ''}
            </p>
            {shown.map((a) => {
              const l = lineOf(a.id, day);
              const canEdit = editable && a.active;
              return (
                <div key={a.id} className="wtr__area">
                  <div className="wtr__line">
                    <span className="wtr__name">{a.name}{a.active ? '' : ' · retired'}</span>
                    {canEdit ? methodSelect(l.method, 'Not watered', `${a.name} method`, (v) => setLine(a.id, { method: v })) : <span>{l.method ? METHOD_LABEL[l.method] : 'Not watered'}</span>}
                    {canEdit ? hoursInput(l.hours, Boolean(l.method), `${a.name} hours run`, (v) => setLine(a.id, { hours: v })) : <span>{l.method ? (l.hours ? `${l.hours} h` : 'hours?') : ''}</span>}
                  </div>
                  <div className="wtr__line">
                    <span className="wtr__supp">Supplementary watering</span>
                    {canEdit ? methodSelect(l.supp_method, 'None', `${a.name} supplementary method`, (v) => setLine(a.id, { supp_method: v })) : <span>{l.supp_method ? METHOD_LABEL[l.supp_method] : 'None'}</span>}
                    {canEdit ? hoursInput(l.supp_hours, Boolean(l.supp_method), `${a.name} supplementary hours run`, (v) => setLine(a.id, { supp_hours: v })) : <span>{l.supp_method ? (l.supp_hours ? `${l.supp_hours} h` : 'hours?') : ''}</span>}
                  </div>
                  {canEdit
                    ? <input className="field field--sm" type="text" maxLength={NOTES_MAX} placeholder={`Notes for ${a.name}`} aria-label={`${a.name} notes`} value={l.notes} onChange={(e) => setLine(a.id, { notes: e.target.value })} />
                    : l.notes ? <p className="caption">{l.notes}</p> : null}
                </div>
              );
            })}
            {editable && (
              <div className="dw-rates__form" style={{ marginTop: '0.8rem' }}>
                <button type="button" className="button" disabled={busy} onClick={() => void saveDay()}>{busy ? 'Saving…' : `Save ${DAY_LONG[i]}`}</button>
                <span className="caption">Saving records the day: an area left at “Not watered” prints as not watered. Hours can be added later — the register keeps asking.</span>
              </div>
            )}
            {!editable && !closed && day <= today && <p className="caption">Your role reads the watering register; the leading hand, supervisor or office records it.</p>}
            {msg && <p className={`notice${msg.kind === 'bad' ? ' alert' : msg.kind === 'kept' ? ' gap' : ''}`} role="status">{msg.text}</p>}
          </section>

          <div className="wtr__gridwrap">
            <table className="wtr__grid">
              <thead>
                <tr>
                  <th>Area</th>
                  {week.map((d, k) => <th key={d} className={d === day ? 'wtr__col--on' : ''}><button type="button" className="wtr__colbtn" disabled={d > today} onClick={() => setDay(d)}>{DAY_SHORT[k]} {dm(d)}</button></th>)}
                  <th className="wtr__wk">Week</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="wtr__muted">Max temp</td>
                  {week.map((d) => { const t = readTemp(temps[d] ?? ''); return <td key={d} className={d === day ? 'wtr__col--on' : ''}>{t.value != null ? `${t.value.toFixed(1)}°` : <span className="wtr__muted">—</span>}</td>; })}
                  <td />
                </tr>
                {shown.map((a) => {
                  const row = week.map((d) => toLine(lineOf(a.id, d)));
                  const h = areaHours(row);
                  return (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      {week.map((d, k) => {
                        const l = row[k];
                        const state = cellState(isBlank(l) ? null : l, recorded.has(d), d, today);
                        return (
                          <td key={d} className={d === day ? 'wtr__col--on' : ''}>
                            {state === 'watered' ? <>
                              {l.method && <span>{part(l.method, l.hours)}</span>}
                              {l.supp_method && <span className="wtr__plus">+ {part(l.supp_method, l.supp_hours)}</span>}
                            </> : state === 'not_watered' ? <span className="wtr__muted">Not watered</span> : state === 'not_recorded' ? <span className="wtr__amber">—</span> : null}
                            {l.notes && <span className="wtr__note" title={l.notes}>note</span>}
                          </td>
                        );
                      })}
                      <td className="wtr__wk">{h.any ? `${fmtHours(h.total)} h` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="caption"><span className="wtr__key">+ lines</span> are supplementary watering · an amber dash is a day nobody has recorded · “hours?” is watering recorded with no hours beside it.</p>

          <div className="dw-rates__form" style={{ marginTop: '0.9rem' }}>
            <a className="button button--quiet" href={`/api/watering/pdf?project=${projectId}&week=${monday}`} target="_blank" rel="noreferrer">Print the week</a>
            {canClose && !closed && over && !confirmClose && <button type="button" className="button button--quiet" disabled={busy || cannotClose.length > 0} onClick={() => setConfirmClose(true)}>Close the week</button>}
          </div>
          {canClose && !closed && over && cannotClose.length > 0 && (
            <p className="notice gap">The week closes once this is answered: {cannotClose.join(' ')}</p>
          )}
          {confirmClose && !closed && (
            <div className="notice gap">
              <p style={{ margin: 0 }}>Close the week of {dmy(monday)}? Nothing in it can be changed afterwards.{unrecorded.length ? ` ${unrecorded.length} day${unrecorded.length === 1 ? '' : 's'} nobody recorded will print as not recorded.` : ''}</p>
              <div className="dw-rates__form" style={{ marginTop: '0.5rem' }}>
                <button type="button" className="button" disabled={busy} onClick={() => void closeWeek()}>{busy ? 'Closing…' : 'Yes, close it'}</button>
                <button type="button" className="quotebtn" onClick={() => setConfirmClose(false)}>Not yet</button>
              </div>
            </div>
          )}
        </>
      )}

      {office && (
        <div style={{ marginTop: '1.2rem' }}>
          {shown.length === 0 && <p className="notice">This job has no watering register yet. Add the areas that are watered and it starts — the section then shows in the menu for this job.</p>}
          <Fold label="Areas on this job’s register" count={areas.filter((a) => a.active).length}>
            {areas.map((a) => (
              <div key={a.id} className="dw-rates__form" style={{ padding: '0.3rem 0' }}>
                <span style={{ flex: '1 1 12rem' }}>{a.name}{a.active ? '' : ' · retired'}</span>
                <button type="button" className="quotebtn" disabled={busy} onClick={() => void setActive(a, !a.active)}>{a.active ? 'Retire' : 'Restore'}</button>
              </div>
            ))}
            <label className="fieldcell" style={{ marginTop: '0.6rem' }}><span className="label">Add areas · one to a line</span>
              <textarea className="field" rows={3} placeholder={'East Gate\nBus Port'} value={newAreas} onChange={(e) => setNewAreas(e.target.value)} />
            </label>
            <div className="dw-rates__form" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="button button--quiet" disabled={busy || !newAreas.trim()} onClick={() => void addAreas()}>{busy ? 'Saving…' : 'Add areas'}</button>
              <span className="caption">A retired area leaves the weeks to come and stays on the weeks it was watered in. Nothing is deleted.</span>
            </div>
            {shown.length === 0 && msg && <p className={`notice${msg.kind === 'bad' ? ' alert' : ''}`} role="status">{msg.text}</p>}
          </Fold>
        </div>
      )}
    </>
  );
}
