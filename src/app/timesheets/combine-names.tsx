'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * The office's list of names that are one person (README R107): pick the name as it was written and the person it
 * is. Undo removes the line; the diaries keep the name as it was said either way.
 */
export function CombineNames({ orgId, names, combined }: {
  orgId: string;
  names: string[];
  combined: Array<{ id: string; alias: string; name: string; note: string | null }>;
}) {
  const router = useRouter();
  const [alias, setAlias] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setError(null);
    try {
      const { error: err } = await fn();
      if (err) throw new Error(/duplicate key/i.test(err.message) ? 'That name is already combined with someone. Undo that first.' : err.message);
      setAlias(''); setName('');
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="combine-names">
      <p className="label">Same person, different name</p>
      <p className="caption">When the diaries spell one person two ways, say so once and the timesheet adds them up as one. The diaries keep the name as it was said.</p>
      {error && <p className="alert">{error}</p>}
      <div className="combine-names__row">
        <label className="fieldcell" htmlFor="combine-alias"><span className="label">This name</span>
          <select id="combine-alias" className="field field--sm" value={alias} onChange={(e) => setAlias(e.target.value)}>
            <option value="">Pick a name…</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <label className="fieldcell" htmlFor="combine-name"><span className="label">is the same person as</span>
          <select id="combine-name" className="field field--sm" value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">Pick a name…</option>
            {names.filter((n) => n !== alias).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <button type="button" className="button" disabled={busy || !alias || !name}
          onClick={() => void run(() => createClient().from('person_aliases').insert({ org_id: orgId, alias, name }))}>
          {busy ? 'Saving…' : 'Combine'}
        </button>
      </div>
      {combined.length > 0 && (
        <ul className="plainlist combine-names__list">
          {combined.map((c) => (
            <li key={c.id}>
              <span><strong>{c.alias}</strong> is <strong>{c.name}</strong>{c.note ? <span className="caption"> · {c.note}</span> : null}</span>
              <button type="button" className="quotebtn" disabled={busy} onClick={() => void run(() => createClient().from('person_aliases').delete().eq('id', c.id))}>Undo</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
