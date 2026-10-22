'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtMoney } from '@/lib/money';
import { Fold } from '@/components/fold';
import type { MachineInPeriod, PersonInPeriod } from '@/lib/dayworks/costing';

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The rates the period's dayworks are costed at, set here on the Dayworks screen because this is where the figure is
 * wanted (README R158, R159). By person: the company's `person_rates`, one row per person named on an item. By
 * machine: the rate card's plant rates (`rate_items`, R104), one row per machine picked on an item. Each writes the
 * row itself under the caller's RLS — an admin — and re-reads the page, so the amounts beside the items are what is
 * stored. A person or machine with no rate is the reason an item has no amount, and is flagged here and there alike.
 */
export function RatesBlock({ orgId, people, rates, machines, plantRates, canWrite }: {
  orgId: string;
  people: PersonInPeriod[];
  rates: Array<{ id: string; person_name: string; rate: number; notes: string | null }>;
  machines: MachineInPeriod[];
  plantRates: Array<{ id: string; plant_id: string | null; label: string; rate: number; scope: 'job' | 'company' }>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const rowFor = (person: string) => rates.find((r) => norm(r.person_name) === norm(person)) ?? null;
  // The same resolution as the costing (plantRateIndex): the row that names the machine, else the first by name.
  const plantRowFor = (m: MachineInPeriod) => (m.plant_id ? plantRates.find((r) => r.plant_id === m.plant_id) : undefined) ?? plantRates.find((r) => norm(r.label) === norm(m.name)) ?? null;
  const missingPeople = people.filter((p) => p.rate == null).length;
  const missingMachines = machines.filter((m) => m.rate == null).length;
  const missing = missingPeople + missingMachines;

  const parse = () => { const rate = Number(value.replace(/[$,\s]/g, '')); return value.trim() === '' || !Number.isFinite(rate) || rate < 0 ? null : rate; };

  async function savePerson(person: string) {
    const rate = parse();
    if (rate == null) { setError('The rate is a number of dollars an hour, 0 or more.'); return; }
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const existing = rowFor(person);
      const { error: e } = existing
        ? await supabase.from('person_rates').update({ rate }).eq('id', existing.id)
        : await supabase.from('person_rates').insert({ org_id: orgId, person_name: person, rate });
      if (e) throw new Error(/row-level security/i.test(e.message) ? 'Only an admin with their code entered sets a rate.' : /duplicate key/i.test(e.message) ? 'There is already a live rate for that name.' : e.message);
      setEditing(null); setAdding(false); setNewName(''); setValue('');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  async function saveMachine(m: MachineInPeriod) {
    const rate = parse();
    if (rate == null) { setError('The rate is a number of dollars an hour, 0 or more.'); return; }
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const existing = plantRowFor(m);
      // A company rate for the machine (R104): the job's own, set on the Rates page, would replace it here.
      const { error: e } = existing
        ? await supabase.from('rate_items').update({ rate }).eq('id', existing.id)
        : await supabase.from('rate_items').insert({ org_id: orgId, project_id: null, kind: 'plant', label: m.name, plant_id: m.plant_id, unit: 'hour', rate });
      if (e) throw new Error(/row-level security/i.test(e.message) ? 'Only an admin sets a machine rate.' : /duplicate key/i.test(e.message) ? 'There is already a live rate of that name on the card.' : e.message);
      setEditing(null); setValue('');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  const form = (key: string, onSave: () => void) => (
    <form className="dw-rates__form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <span className="dw-rates__dollar">$</span>
      <input className="field field--sm dw-rates__in" inputMode="decimal" autoFocus value={value} placeholder="105" aria-label={`${key}: rate an hour`} onChange={(e) => setValue(e.target.value)} />
      <span className="caption">/ hour ex GST</span>
      <button type="submit" className="button button--quiet" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="quotebtn" disabled={busy} onClick={() => { setEditing(null); setAdding(false); setError(null); }}>Cancel</button>
    </form>
  );

  const others = rates.filter((r) => !people.some((p) => norm(p.person) === norm(r.person_name)));

  return (
    <div className={`dw-rates${missing ? ' dw-rates--missing' : ''}`}>
      <Fold label={missing ? `Rates by person and machine · ${missing} without a rate` : 'Rates by person and machine'} count={people.length + machines.length}>
        <p className="caption">What each person and machine on these dayworks is charged at, an hour ex GST. An item's amount is each person's hours at their rate and each machine's hours at its rate, added up; one without a rate leaves the item blank until a rate is set here.</p>
        {error && <p className="alert">{error}</p>}
        <p className="label">People</p>
        {people.length === 0 && <p className="caption">Nobody is named on these items yet.</p>}
        <ul className="plainlist dw-rates__list">
          {people.map((p) => (
            <li key={`p-${p.person}`} className={`dw-rates__row${p.rate == null ? ' dw-rates__row--missing' : ''}`}>
              <span className="dw-rates__who">
                <b>{p.person}</b>
                <span className="caption">{hrs(p.hours)} h on {p.items} item{p.items === 1 ? '' : 's'}{p.hoursNotRecorded ? ` · ${p.hoursNotRecorded} without hours` : ''}</span>
              </span>
              {editing === `p-${p.person}` ? form(p.person, () => void savePerson(p.person)) : (
                <span className="dw-rates__rate">
                  {p.rate == null ? <span className="claims-flag">No rate</span> : <span className="mono">{fmtMoney(p.rate)} / h</span>}
                  {canWrite && <button type="button" className="quotebtn" disabled={busy} onClick={() => { setEditing(`p-${p.person}`); setAdding(false); setValue(p.rate == null ? '' : String(p.rate)); setError(null); }}>{p.rate == null ? 'Set' : 'Change'}</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <p className="caption">Also on the company's list, not on these items: {others.map((r) => `${r.person_name} ${fmtMoney(r.rate)}`).join(' · ')}.</p>
        )}
        {canWrite && (adding ? (
          <div className="dw-rates__add">
            <label className="fieldcell"><span className="label">Name, as it goes on the sheets</span>
              <input className="field field--sm" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
            {form(newName.trim(), () => void savePerson(newName.trim()))}
          </div>
        ) : (
          <button type="button" className="quotebtn" disabled={busy} onClick={() => { setAdding(true); setEditing(null); setValue(''); setError(null); }}>Add a rate for someone else</button>
        ))}

        <p className="label dw-rates__sub">Machines</p>
        {machines.length === 0 && <p className="caption">No machine is picked on these items yet — “Pick plant” on an item names them.</p>}
        <ul className="plainlist dw-rates__list">
          {machines.map((m) => {
            const key = `m-${m.plant_id ?? norm(m.name)}`;
            const row = plantRowFor(m);
            return (
              <li key={key} className={`dw-rates__row${m.rate == null ? ' dw-rates__row--missing' : ''}`}>
                <span className="dw-rates__who">
                  <b>{m.name}</b>
                  <span className="caption">{hrs(m.hours)} h on {m.items} item{m.items === 1 ? '' : 's'}{m.hoursNotRecorded ? ` · ${m.hoursNotRecorded} without hours` : ''}{row?.scope === 'job' ? ' · this job’s own rate' : ''}</span>
                </span>
                {editing === key ? form(m.name, () => void saveMachine(m)) : (
                  <span className="dw-rates__rate">
                    {m.rate == null ? <span className="claims-flag">No rate</span> : <span className="mono">{fmtMoney(m.rate)} / h</span>}
                    {canWrite && <button type="button" className="quotebtn" disabled={busy} onClick={() => { setEditing(key); setAdding(false); setValue(m.rate == null ? '' : String(m.rate)); setError(null); }}>{m.rate == null ? 'Set' : 'Change'}</button>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {!canWrite && <p className="caption">Rates are set by an admin.</p>}
      </Fold>
    </div>
  );
}
