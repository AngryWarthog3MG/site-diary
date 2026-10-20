'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtMoney } from '@/lib/money';
import { Fold } from '@/components/fold';
import type { PersonInPeriod } from '@/lib/dayworks/costing';

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/**
 * The rate each person on the period's dayworks is charged at (README R158), set here on the Dayworks screen because
 * this is where the figure is wanted. One row per person named on an item: their hours over the period, their rate,
 * and a box to set or change it. Writes the company's `person_rates` row itself under the caller's RLS — an admin —
 * and re-reads the page, so the amounts beside the items are what is stored. A person with no rate is the reason an
 * item has no amount, and is flagged here and there alike.
 */
export function PersonRatesBlock({ orgId, people, rates, canWrite }: {
  orgId: string;
  people: PersonInPeriod[];
  rates: Array<{ id: string; person_name: string; rate: number; notes: string | null }>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const rowFor = (person: string) => rates.find((r) => norm(r.person_name) === norm(person)) ?? null;
  const missing = people.filter((p) => p.rate == null).length;

  async function save(person: string) {
    const rate = Number(value.replace(/[$,\s]/g, ''));
    if (value.trim() === '' || !Number.isFinite(rate) || rate < 0) { setError('The rate is a number of dollars an hour, 0 or more.'); return; }
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

  const form = (person: string) => (
    <form className="dw-rates__form" onSubmit={(e) => { e.preventDefault(); void save(person); }}>
      <span className="dw-rates__dollar">$</span>
      <input className="field field--sm dw-rates__in" inputMode="decimal" autoFocus value={value} placeholder="105" aria-label={`${person}'s rate an hour`} onChange={(e) => setValue(e.target.value)} />
      <span className="caption">/ hour ex GST</span>
      <button type="submit" className="button button--quiet" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="quotebtn" disabled={busy} onClick={() => { setEditing(null); setAdding(false); setError(null); }}>Cancel</button>
    </form>
  );

  const others = rates.filter((r) => !people.some((p) => norm(p.person) === norm(r.person_name)));

  return (
    <div className={`dw-rates${missing ? ' dw-rates--missing' : ''}`}>
      <Fold label={missing ? `Rates by person · ${missing} without a rate` : 'Rates by person'} count={people.length}>
        <p className="caption">What each person named on these dayworks is charged at, an hour ex GST. An item's amount is each person's hours at their rate, added up; a person with no rate leaves it blank until one is set here.</p>
        {error && <p className="alert">{error}</p>}
        <ul className="plainlist dw-rates__list">
          {people.map((p) => (
            <li key={p.person} className={`dw-rates__row${p.rate == null ? ' dw-rates__row--missing' : ''}`}>
              <span className="dw-rates__who">
                <b>{p.person}</b>
                <span className="caption">{hrs(p.hours)} h on {p.items} item{p.items === 1 ? '' : 's'}{p.hoursNotRecorded ? ` · ${p.hoursNotRecorded} without hours` : ''}</span>
              </span>
              {editing === p.person ? form(p.person) : (
                <span className="dw-rates__rate">
                  {p.rate == null ? <span className="claims-flag">No rate</span> : <span className="mono">{fmtMoney(p.rate)} / h</span>}
                  {canWrite && <button type="button" className="quotebtn" disabled={busy} onClick={() => { setEditing(p.person); setAdding(false); setValue(p.rate == null ? '' : String(p.rate)); setError(null); }}>{p.rate == null ? 'Set' : 'Change'}</button>}
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
            {form(newName.trim())}
          </div>
        ) : (
          <button type="button" className="quotebtn" disabled={busy} onClick={() => { setAdding(true); setEditing(null); setValue(''); setError(null); }}>Add a rate for someone else</button>
        ))}
        {!canWrite && <p className="caption">Rates are set by an admin.</p>}
      </Fold>
    </div>
  );
}
