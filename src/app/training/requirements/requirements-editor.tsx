'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Competency } from '@/lib/training/model';

interface Props { orgId: string; userId: string; roles: string[]; requirements: Array<{ role: string; competency: string }>; competencies: Competency[]; custom: Array<{ id: string; key: string; label: string; valid_months: number | null; active: boolean }> }

export function RequirementsEditor({ orgId, userId, roles, requirements, competencies, custom }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState('');
  const [label, setLabel] = useState(''); const [months, setMonths] = useState('');
  const allRoles = [...new Set([...roles, ...requirements.map((r) => r.role)])].sort();
  const has = (role: string, key: string) => requirements.some((r) => r.role === role && r.competency === key);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(false); }
  }
  const toggle = (role: string, key: string) => run(async () => {
    const supabase = createClient();
    if (has(role, key)) { const { error: e } = await supabase.from('competency_requirements').delete().eq('org_id', orgId).eq('role', role).eq('competency', key); if (e) throw new Error(e.message); }
    else { const { error: e } = await supabase.from('competency_requirements').insert({ org_id: orgId, role, competency: key, created_by: userId }); if (e) throw new Error(e.message); }
  });
  const addCustom = () => run(async () => {
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!label.trim() || key.length < 2) throw new Error('Give the competency a name.');
    const { error: e } = await createClient().from('org_competencies').insert({ org_id: orgId, key, label: label.trim(), valid_months: months ? Number(months) : null, created_by: userId });
    if (e) throw new Error(/org_competencies_key_idx/.test(e.message) ? 'That competency exists.' : e.message);
    setLabel(''); setMonths('');
  });
  const retireCustom = (id: string, active: boolean) => run(async () => {
    const { error: e } = await createClient().from('org_competencies').update({ active: !active }).eq('id', id); if (e) throw new Error(e.message);
  });
  return (
    <div className="requirements">
      {allRoles.length === 0 && <p className="nil">No roles yet — give people a role on the crew list under Settings, or type one below.</p>}
      <div className="matrix__scroll">
        <table className="matrix__table">
          <thead><tr><th className="matrix__person">Role</th>{competencies.map((c) => <th key={c.key} className="matrix__col"><span>{c.label}</span></th>)}</tr></thead>
          <tbody>
            {allRoles.map((role) => (
              <tr key={role}>
                <td className="matrix__person"><strong>{role}</strong></td>
                {competencies.map((c) => (
                  <td key={c.key} className={`matrix__cell${has(role, c.key) ? ' matrix__cell--required-on' : ''}`}>
                    <button type="button" className="matrix__mark" disabled={busy} onClick={() => void toggle(role, c.key)}>{has(role, c.key) ? '✓' : '·'}</button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="signin__grid">
        <input className="field field--sm" value={newRole} placeholder="Another role — operator, labourer, traffic controller…" onChange={(e) => setNewRole(e.target.value)} />
        <button type="button" className="button button--quiet" style={{ marginTop: 0, width: 'auto' }} disabled={busy || !newRole.trim() || competencies.length === 0} onClick={() => void toggle(newRole.trim().toLowerCase(), 'white_card')}>Add role (white card)</button>
      </div>
      <div className="item">
        <p className="label">The company&rsquo;s own competencies</p>
        {custom.map((c) => <p key={c.id} className="caption">{c.label}{c.valid_months ? ` · valid ${c.valid_months} months` : ''}{c.active ? '' : ' · retired'} <button type="button" className="linklike" disabled={busy} onClick={() => void retireCustom(c.id, c.active)}>{c.active ? 'Retire' : 'Bring back'}</button></p>)}
        <div className="signin__grid">
          <input className="field field--sm" value={label} placeholder="KBS site induction, Vac truck VOC…" onChange={(e) => setLabel(e.target.value)} />
          <input className="field field--sm" type="number" min={1} max={120} value={months} placeholder="Valid months" onChange={(e) => setMonths(e.target.value)} />
        </div>
        <button type="button" className="button button--quiet" disabled={busy || !label.trim()} onClick={() => void addCustom()}>Add competency</button>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
