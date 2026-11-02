'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BUILT_IN_ROOT_CAUSES, BUILT_IN_FACTORS, CAUSE_KIND_LABEL, type CauseKind } from '@/lib/incidents/investigation';
import { BUILT_IN_HAZARD_TYPES } from '@/lib/incidents/controls';

type ListKind = CauseKind | 'hazard_type';
const LIST_LABEL: Record<ListKind, string> = { ...CAUSE_KIND_LABEL, hazard_type: 'Hazard types' };
const BUILT_IN: Record<ListKind, ReadonlyArray<{ key: string; label: string }>> = { root_cause: BUILT_IN_ROOT_CAUSES, contributing_factor: BUILT_IN_FACTORS, hazard_type: BUILT_IN_HAZARD_TYPES };

interface Row { id: string; kind: ListKind; key: string; label: string; active: boolean }

const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export function CausesEditor({ orgId, userId, rows }: { orgId: string; userId: string; rows: Row[] }) {
  const router = useRouter();
  const [label, setLabel] = useState<Record<ListKind, string>>({ hazard_type: '', root_cause: '', contributing_factor: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); } finally { setBusy(false); }
  }
  const add = (kind: ListKind) => run(async () => {
    const text = label[kind].trim(); if (!text) throw new Error('Write the cause first.');
    const key = keyOf(text); if (key.length < 2) throw new Error('Use a few letters or numbers in it.');
    const { error: e } = await createClient().from('org_incident_causes').insert({ org_id: orgId, kind, key, label: text, created_by: userId });
    if (e) throw new Error(/duplicate/i.test(e.message) ? 'That one is already on the list.' : e.message);
    setLabel({ ...label, [kind]: '' });
  });
  const toggle = (r: Row) => run(async () => {
    const { data, error: e } = await createClient().from('org_incident_causes').update({ active: !r.active }).eq('id', r.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });

  return (
    <div>
      {(['hazard_type', 'root_cause', 'contributing_factor'] as ListKind[]).map((kind) => {
        const own = rows.filter((r) => r.kind === kind);
        const builtIn = BUILT_IN[kind];
        return (
          <section key={kind} className="item" style={{ marginTop: '1rem' }}>
            <p className="label">{LIST_LABEL[kind]}</p>
            <p className="caption">Built in: {builtIn.map((b) => b.label).join(' · ')}</p>
            {own.length === 0 ? <p className="nil">None of the company&rsquo;s own yet.</p> : (
              <ul className="plainlist">
                {own.map((r) => (
                  <li key={r.id} className="incident__action">
                    <span className={r.active ? '' : 'caption'}>{r.label}{r.active ? '' : ' (retired)'}</span>
                    <button type="button" className="linklike" disabled={busy} onClick={() => void toggle(r)}>{r.active ? 'Retire' : 'Bring back'}</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Add one</span>
                <input className="field field--sm" value={label[kind]} maxLength={120} onChange={(e) => setLabel({ ...label, [kind]: e.target.value })} /></label>
              <button type="button" className="button button--quiet" disabled={busy || !label[kind].trim()} onClick={() => void add(kind)}>Add</button>
            </div>
          </section>
        );
      })}
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
