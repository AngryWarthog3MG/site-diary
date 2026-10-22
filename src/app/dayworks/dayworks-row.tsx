'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtMoney } from '@/lib/money';
import { fmtDate } from '@/lib/pdf/dates';
import { whyNoAmount, type LineCost, type PlantRow } from '@/lib/dayworks/costing';
import type { LabourRow } from '@/lib/pdf/labour-rows';

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
const OTHER = '__other__';

export interface DayworksRowProps {
  projectId: string;
  date: string;
  entryId: string | null;
  dayworkId: string | null;
  works: string;
  hours: number | null;
  docket: string | null;
  docketAddedOn: string | null;
  labour: string | null;
  plant: string | null;
  materials: string | null;
  approved: { signedOn: string; name: string } | null;
  /** The item costed — present for a register keeper; its amounts only when `money`. */
  cost: LineCost | null;
  money: boolean;
  allocation: { labour: LabourRow[]; plant: PlantRow[]; note: string | null; excluded: boolean; excludedReason: string | null; carriedFrom: string | null } | null;
  canAllocate: boolean;
  /** The job's people, to pick from (R128): the crew list and the staff list. */
  people: string[];
  /** The job's machines, to pick from: the plant register. */
  machines: Array<{ id: string; name: string; plantNo: string | null }>;
}

/**
 * One daywork on the schedule (README R158, R159). Under Labour, the people on it at their hours and rate; under
 * Plant, the machines picked for it; in Amount, the item's total or the one reason it has none. "Pick people" and
 * "Pick plant" open the office's costing allocation for the item — kept beside the signed day, never in it — where
 * a keeper picks who and what from the job's lists with their hours. The people are picked only where the signed row
 * names nobody; where it does, the record wins and only the plant is picked here.
 */
export function DayworksRow(p: DayworksRowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const cost = p.cost;
  const labourFromRecord = cost?.labourFrom === 'record';
  const canPick = p.canAllocate && Boolean(p.dayworkId);
  const colSpan = p.money ? 7 : 8;
  const excluded = Boolean(cost?.excluded);

  return (
    <>
      <tr className={`dw-row${open ? ' dw-row--open' : ''}${excluded && p.money ? ' dw-row--excluded' : ''}`}>
        <td className="mono">{p.entryId ? <Link className="claims-cite" href={`/entries/${p.entryId}/signed`}>{fmtDate(p.date)}</Link> : fmtDate(p.date)}</td>
        <td>{p.works}</td>
        <td className={`n mono${p.hours == null ? ' claims-flag' : ''}`}>{p.hours == null ? 'Not recorded' : hrs(p.hours)}</td>
        {p.money && <AmountCell cost={cost} />}
        {!p.money && <td className={p.approved ? undefined : 'claims-flag'}>{p.approved ? <>Signed {fmtDate(p.approved.signedOn)}<span className="vr-note">{p.approved.name}</span></> : 'Not yet'}</td>}
        {!p.money && <td className={p.docket ? 'mono' : 'claims-flag'}>{p.docket ?? 'To chase'}{p.docketAddedOn ? <span className="vr-note">added {fmtDate(p.docketAddedOn)}</span> : null}</td>}
        <td>
          {cost && !cost.noRows ? <LabourCosted cost={cost} money={p.money} /> : (p.labour ?? '—')}
          {cost?.labourFrom === 'allocation' && <span className="vr-note">picked by the office — the day says: {p.labour ?? '—'}</span>}
          {p.allocation?.carriedFrom && <span className="vr-note claims-flag">carried from the earlier version of this day — open and save to keep it on this one</span>}
          {canPick && cost && !labourFromRecord && !open && (
            <button type="button" className="quotebtn dw-pick" onClick={() => setOpen(true)}>{cost.labourFrom === 'allocation' ? 'Change people' : 'Pick people'}</button>
          )}
        </td>
        <td>
          {cost && cost.machines.length > 0 ? <PlantCosted cost={cost} money={p.money} /> : (p.plant ?? '—')}
          {cost && cost.machines.length > 0 && <span className="vr-note">the day says: {p.plant ?? '—'}</span>}
          {canPick && cost && !open && (
            <button type="button" className="quotebtn dw-pick" onClick={() => setOpen(true)}>{cost.machines.length ? 'Change plant' : 'Pick plant'}{excluded ? ' · put back' : ''}</button>
          )}
        </td>
        <td>{p.materials ?? '—'}</td>
      </tr>
      {open && p.dayworkId && (
        <tr className="dw-row dw-row--editor">
          <td colSpan={colSpan}>
            <AllocationEditor
              projectId={p.projectId}
              dayworkId={p.dayworkId}
              recordedHours={p.hours}
              labourText={p.labour}
              plantText={p.plant}
              labourLocked={labourFromRecord}
              initial={p.allocation}
              people={p.people}
              machines={p.machines}
              onClose={() => setOpen(false)}
              onSaved={() => { setOpen(false); router.refresh(); }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** The item's amount, or the one reason it has none (README R158). */
function AmountCell({ cost }: { cost: LineCost | null }) {
  if (!cost) return <td className="n claims-flag">—</td>;
  if (cost.excluded) return <td className="n claims-flag">Left out of the claim{cost.excludedReason ? <span className="vr-note">{cost.excludedReason}</span> : null}</td>;
  if (cost.amount != null) {
    return <td className="n mono">{fmtMoney(cost.amount)}{cost.plantNotCosted ? <span className="vr-note claims-flag">plant not costed</span> : null}</td>;
  }
  return <td className="n claims-flag">{whyNoAmount(cost)}</td>;
}

/** The people on the item, each at their hours and rate (README R158). */
function LabourCosted({ cost, money }: { cost: LineCost; money: boolean }) {
  return (
    <ul className="dw-people">
      {cost.people.map((pp, i) => (
        <li key={i} className={money && pp.amount == null ? 'dw-people__row dw-people__row--gap' : 'dw-people__row'}>
          <span className="dw-people__name">{pp.name}{pp.person !== pp.name ? <span className="vr-note">as {pp.person}</span> : null}</span>
          <span className="mono dw-people__sum">
            {pp.hours == null ? 'no hours' : `${hrs(pp.hours)} h`}
            {money ? <> × {pp.rate == null ? 'no rate' : fmtMoney(pp.rate)}{pp.amount != null ? ` = ${fmtMoney(pp.amount)}` : ''}</> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The machines picked for the item, each at their hours and the rate card's rate (README R159). */
function PlantCosted({ cost, money }: { cost: LineCost; money: boolean }) {
  return (
    <ul className="dw-people">
      {cost.machines.map((m, i) => (
        <li key={i} className={money && m.amount == null ? 'dw-people__row dw-people__row--gap' : 'dw-people__row'}>
          <span className="dw-people__name">{m.name}</span>
          <span className="mono dw-people__sum">
            {m.hours == null ? 'no hours' : `${hrs(m.hours)} h`}
            {money ? <> × {m.rate == null ? 'no rate' : fmtMoney(m.rate)}{m.amount != null ? ` = ${fmtMoney(m.amount)}` : ''}</> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

type LabourDraft = { pick: string; name: string; hours: string };
type PlantDraft = { pick: string; name: string; hours: string };

/**
 * The costing allocation for one daywork (README R159): the people (unless the row names its own) and the machines,
 * each picked from the job's list with their hours, saved as one row beside the day. The recorded hours are shown so
 * a split that does not add up is seen, not stopped — the office knows the day better than a rule does.
 */
function AllocationEditor({ projectId, dayworkId, recordedHours, labourText, plantText, labourLocked, initial, people, machines, onClose, onSaved }: {
  projectId: string; dayworkId: string; recordedHours: number | null; labourText: string | null; plantText: string | null; labourLocked: boolean;
  initial: { labour: LabourRow[]; plant: PlantRow[]; note: string | null; excluded: boolean; excludedReason: string | null; carriedFrom: string | null } | null;
  people: string[]; machines: Array<{ id: string; name: string; plantNo: string | null }>;
  onClose: () => void; onSaved: () => void;
}) {
  const known = new Set(people.map((n) => n.toLowerCase()));
  const toLabour = (r: LabourRow): LabourDraft => ({ pick: known.has(r.person_name.toLowerCase()) ? people.find((n) => n.toLowerCase() === r.person_name.toLowerCase())! : OTHER, name: r.person_name, hours: r.hours == null ? '' : String(r.hours) });
  const toPlant = (r: PlantRow): PlantDraft => ({ pick: r.plant_id && machines.some((m) => m.id === r.plant_id) ? r.plant_id : OTHER, name: r.name, hours: r.hours == null ? '' : String(r.hours) });
  const [labour, setLabour] = useState<LabourDraft[]>(initial?.labour.map(toLabour) ?? []);
  const [plant, setPlant] = useState<PlantDraft[]>(initial?.plant.map(toPlant) ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [excluded, setExcluded] = useState(initial?.excluded ?? false);
  const [reason, setReason] = useState(initial?.excludedReason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => { const t = s.trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
  const labourTotal = labour.reduce((t, r) => { const n = num(r.hours); return n == null || Number.isNaN(n) ? t : t + n; }, 0);
  const labourNoHours = labour.filter((r) => num(r.hours) == null).length;

  async function save() {
    setError(null);
    const labourRows = labour.map((r) => ({ person_name: (r.pick === OTHER ? r.name : r.pick).trim(), hours: num(r.hours) }));
    const plantRows = plant.map((r) => { const m = machines.find((x) => x.id === r.pick); return { plant_id: m ? m.id : null, name: (m ? m.name : r.name).trim(), hours: num(r.hours) }; });
    if (labourRows.some((r) => !r.person_name)) { setError('Every person needs a name.'); return; }
    if (plantRows.some((r) => !r.name)) { setError('Every machine needs a name.'); return; }
    if ([...labourRows, ...plantRows].some((r) => r.hours != null && (Number.isNaN(r.hours) || r.hours < 0 || r.hours > 24))) { setError('Hours are a number between 0 and 24, or blank.'); return; }
    if (excluded && !reason.trim()) { setError('Say why the item is left out of the claim.'); return; }
    setBusy(true);
    try {
      const { error: e } = await createClient().from('daywork_costings').upsert(
        { project_id: projectId, daywork_id: dayworkId, labour: labourLocked ? [] : labourRows, plant: plantRows, note: note.trim() || null, excluded, excluded_reason: excluded ? reason.trim() || null : null },
        { onConflict: 'daywork_id' },
      );
      if (e) throw new Error(/row-level security/i.test(e.message) ? 'Only someone who keeps the registers picks people and plant.' : e.message);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="dw-alloc">
      <div className="dw-alloc__head">
        <p className="label">Cost this item from</p>
        <p className="caption">Recorded on the day: <b>{recordedHours == null ? 'hours not recorded' : `${hrs(recordedHours)} h`}</b> · labour “{labourText ?? '—'}” · plant “{plantText ?? '—'}”. What you pick here is the office’s costing, kept beside the signed day; the day itself does not change.</p>
      </div>
      <div className="dw-alloc__cols">
        <div className="dw-alloc__col">
          <p className="label">People and their hours</p>
          {labourLocked ? (
            <p className="caption">The signed day names its people and their hours; they are costed as recorded.</p>
          ) : (
            <>
              {labour.map((r, i) => (
                <div key={i} className="dw-alloc__line">
                  <select className="field field--sm" value={r.pick} aria-label="Person" onChange={(e) => setLabour(labour.map((x, j) => (j === i ? { ...x, pick: e.target.value } : x)))}>
                    <option value="">Pick a person…</option>
                    {people.map((n) => <option key={n} value={n}>{n}</option>)}
                    <option value={OTHER}>Someone else…</option>
                  </select>
                  {r.pick === OTHER && <input className="field field--sm" placeholder="Their name" value={r.name} onChange={(e) => setLabour(labour.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}
                  <input className="field field--sm dw-alloc__hrs" inputMode="decimal" placeholder="h" aria-label="Hours" value={r.hours} onChange={(e) => setLabour(labour.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} />
                  <button type="button" className="quotebtn quotebtn--remove" onClick={() => setLabour(labour.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <button type="button" className="quotebtn" onClick={() => setLabour([...labour, { pick: '', name: '', hours: '' }])}>+ Add a person</button>
              {labour.length > 0 && recordedHours != null && labourNoHours === 0 && Math.abs(labourTotal - recordedHours) > 0.01 && (
                <p className="caption claims-flag">The people’s hours add up to {hrs(labourTotal)} h; the day recorded {hrs(recordedHours)} h on this item. If the day’s figure was the total between them, the split is yours to say — nothing is divided for you.</p>
              )}
            </>
          )}
        </div>
        <div className="dw-alloc__col">
          <p className="label">Machines and their hours</p>
          {plant.map((r, i) => (
            <div key={i} className="dw-alloc__line">
              <select className="field field--sm" value={r.pick} aria-label="Machine" onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, pick: e.target.value } : x)))}>
                <option value="">Pick a machine…</option>
                {machines.map((m) => <option key={m.id} value={m.id}>{m.name}{m.plantNo ? ` · ${m.plantNo}` : ''}</option>)}
                <option value={OTHER}>Another machine…</option>
              </select>
              {r.pick === OTHER && <input className="field field--sm" placeholder="What it is" value={r.name} onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}
              <input className="field field--sm dw-alloc__hrs" inputMode="decimal" placeholder="h" aria-label="Hours" value={r.hours} onChange={(e) => setPlant(plant.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} />
              <button type="button" className="quotebtn quotebtn--remove" onClick={() => setPlant(plant.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="quotebtn" onClick={() => setPlant([...plant, { pick: '', name: '', hours: '' }])}>+ Add a machine</button>
          <p className="caption">A machine is priced at the rate card’s rate for it — set under “Rates by machine” above when one has none.</p>
        </div>
      </div>
      <label className="fieldcell"><span className="label">Note · optional</span>
        <input className="field field--sm" value={note} placeholder="Why it is split this way" onChange={(e) => setNote(e.target.value)} /></label>
      <div className={`dw-alloc__out${excluded ? ' dw-alloc__out--on' : ''}`}>
        <label className="regs__tick"><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /><span>Leave this item out of the claim</span></label>
        {excluded && <input className="field field--sm" value={reason} placeholder="Why — kept with the decision" aria-label="Why it is left out" onChange={(e) => setReason(e.target.value)} />}
        <p className="caption">It stays on the record, the schedule and the sign-off sheet, which say what was expended; the costed schedule drops it and says so, and no total carries it. Untick to put it back.</p>
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="regs__actions">
        <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="quotebtn" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
