'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { newGateToken, gateUrl } from '@/lib/gate/model';

interface Props { projectId: string; userId: string; gate: { id: string; token: string; rules: string; since: string; svg: string } | null; base: string; defaultRules: string }

export function GateAdmin({ projectId, userId, gate, base, defaultRules }: Props) {
  const router = useRouter();
  const [rules, setRules] = useState(gate?.rules ?? defaultRules);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const newCode = () => run('make a new code', async () => {
    if (gate && !window.confirm('Make a new gate code? The printed sign with the old code stops working the moment this saves.')) return;
    const supabase = createClient();
    if (gate) {
      const { error: e } = await supabase.from('gate_tokens').update({ active: false, revoked_at: new Date().toISOString() }).eq('id', gate.id);
      if (e) throw new Error(e.message);
    }
    const { error: e2 } = await supabase.from('gate_tokens').insert({ project_id: projectId, token: newGateToken(), rules: rules.trim() || null, created_by: userId });
    if (e2) throw new Error(e2.message);
  });
  const saveRules = () => run('save the rules', async () => {
    if (!gate) return;
    const { data, error: e } = await createClient().from('gate_tokens').update({ rules: rules.trim() || null }).eq('id', gate.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const printSign = () => run('make the gate sign', async () => {
    const res = await fetch(`/api/gate/sign?project=${projectId}`, { method: 'POST' });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The sign could not be made.');
    window.open(body.url, '_blank', 'noopener');
  });

  return (
    <div className="gate-admin">
      {gate ? (
        <div className="item gate-admin__code">
          <div className="gate-admin__qr" dangerouslySetInnerHTML={{ __html: gate.svg }} />
          <p className="mono gate-admin__url">{gateUrl(gate.token, base)}</p>
          <p className="caption">In use since {fmtPerthDate(gate.since)}. Print it large, laminate it, put it on the gate.</p>
          <div className="photo-add-pair">
            <button type="button" className="button" disabled={busy != null} onClick={() => void printSign()}>{busy === 'make the gate sign' ? 'Making…' : 'Print the gate sign (A4)'}</button>
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void newCode()}>New code</button>
          </div>
        </div>
      ) : (
        <div className="item">
          <p className="label">No gate code yet</p>
          <p>Make one, print the sign, and visitors can sign themselves in.</p>
          <button type="button" className="button" disabled={busy != null} onClick={() => void newCode()}>{busy ? 'Making…' : 'Make a gate code'}</button>
        </div>
      )}
      <div className="item">
        <p className="label">Site rules the visitor accepts</p>
        <textarea className="field field--sm" rows={8} value={rules} onChange={(e) => setRules(e.target.value)} />
        <p className="caption">One rule per line. Shown on the gate page and printed on the sign.</p>
        {gate && <button type="button" className="button button--quiet" disabled={busy != null || rules === gate.rules} onClick={() => void saveRules()}>Save the rules</button>}
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
