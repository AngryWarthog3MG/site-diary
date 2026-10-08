'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Competency } from '@/lib/training/model';

interface Props { orgId: string; userId: string; roles: string[]; requirements: Array<{ role: string; competency: string }>; competencies: Competency[]; custom: Array<{ id: string; key: string; label: string; valid_months: number | null; active: boolean }> }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What each role must hold, one card per role (README R134). The competencies are
 * chips a manager taps on or off — words read across, not a matrix read sideways.
 * A role comes from the crew lists; one typed here lives only as its requirements,
 * and can be removed while nobody on a crew list holds it.
 */
export function RequirementsEditor({ orgId, userId, roles, requirements, competencies, custom }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState('');
  const [label, setLabel] = useState(''); const [months, setMonths] = useState('');
  const allRoles = [...new Set([...roles, ...requirements.map((r) => r.role)])].sort();
  const has = (role: string, key: string) => requirements.some((r) => r.role === role && r.competency === key);
  const onCrew = (role: string) => roles.includes(role);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(false); }
  }
  const toggle = (role: string, key: string) => run(async () => {
    const supabase = createClient();
    if (has(role, key)) { const { error: e } = await supabase.from('competency_requirements').delete().eq('org_id', orgId).eq('role', role).eq('competency', key); if (e) throw new Error(e.message); }
    else { const { error: e } = await supabase.from('competency_requirements').insert({ org_id: orgId, role, competency: key, created_by: userId }); if (e) throw new Error(e.message); }
  });
  const addRole = () => run(async () => {
    const role = newRole.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!role) return;
    if (allRoles.includes(role)) throw new Error(`${cap(role)} is already listed.`);
    const { error: e } = await createClient().from('competency_requirements').insert({ org_id: orgId, role, competency: 'white_card', created_by: userId });
    if (e) throw new Error(e.message);
    setNewRole('');
  });
  const removeRole = (role: string) => run(async () => {
    if (onCrew(role)) throw new Error(`${cap(role)} is on a crew list — change the role there first.`);
    const { error: e } = await createClient().from('competency_requirements').delete().eq('org_id', orgId).eq('role', role);
    if (e) throw new Error(e.message);
  });
  const addCustom = () => run(async () => {
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!label.trim() || key.length < 2) throw new Error('Give the competency a name.');
    const { error: e } = await createClient().from('org_competencies').insert({ org_id: orgId, key, label: label.trim(), valid_months: months ? Number(months) : null, created_by: userId });
    if (e) throw new Error(/org_competencies_key_idx/.test(e.message) ? 'That competency exists.' : e.message);
    setLabel(''); setMonths('');
  });
  const retireCustom = (id: string, active: boolean) => run(async () => {
    const c = custom.find((x) => x.id === id);
    const supabase = createClient();
    if (active && c) {
      // Ask the database now, not the list this page loaded with — another manager may have required it since.
      const { count, error: e } = await supabase.from('competency_requirements').select('role', { count: 'exact', head: true }).eq('org_id', orgId).eq('competency', c.key);
      if (e) throw new Error(e.message);
      if ((count ?? 0) > 0) throw new Error(`${c.label} is still required by a role — untick it there first.`);
    }
    const { error: e } = await supabase.from('org_competencies').update({ active: !active }).eq('id', id); if (e) throw new Error(e.message);
  });
  return (
    <div className="reqs">
      <section className="reqs__roles" aria-label="Roles">
        <p className="label">Roles · {allRoles.length}</p>
        {allRoles.length === 0 && <p className="nil">No roles yet. Give people a role on the staff list, or add one below.</p>}
        {allRoles.map((role) => {
          const n = competencies.filter((c) => has(role, c.key)).length;
          return (
            <article key={role} className="reqs__role">
              <header className="reqs__role-head">
                <h2 className="reqs__role-name">{cap(role)}</h2>
                <p className="caption reqs__role-meta">
                  {n === 0 ? 'Nothing required yet' : `${n} required`}
                  {!onCrew(role) && <> · not on any crew list <button type="button" className="linklike" disabled={busy} onClick={() => void removeRole(role)}>Remove</button></>}
                </p>
              </header>
              <ul className="chips reqs__chips">
                {competencies.map((c) => {
                  const on = has(role, c.key);
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        className={`chip reqs__chip${on ? ' chip--on' : ''}`}
                        aria-pressed={on}
                        disabled={busy || (c.retired === true && !on)}
                        title={c.retired ? 'Retired — can be unticked, not required anew' : on ? 'Required — tap to drop it' : 'Tap to require it'}
                        onClick={() => void toggle(role, c.key)}
                      >
                        <span className="reqs__tick" aria-hidden>{on ? '✓' : '+'}</span>{c.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </section>

      <section className="item reqs__block" aria-label="Add a role">
        <p className="label">Add a role</p>
        <p className="caption">Roles normally come from the staff list. One added here starts with the white card, which everyone on a construction site must hold.</p>
        <div className="reqs__form">
          <input className="field field--sm" value={newRole} placeholder="Traffic controller, plant operator…" aria-label="Role name" onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addRole(); }} />
          <button type="button" className="button button--quiet reqs__button" disabled={busy || !newRole.trim()} onClick={() => void addRole()}>Add role</button>
        </div>
      </section>

      <section className="item reqs__block" aria-label="The company's own competencies">
        <p className="label">The company&rsquo;s own competencies</p>
        <p className="caption">Tickets and inductions of your own, beside the standard ones above — a site induction, a Vac truck VOC. They appear on every role card once added.</p>
        {custom.length > 0 && (
          <ul className="reqs__custom">
            {custom.map((c) => (
              <li key={c.id} className={`reqs__custom-row${c.active ? '' : ' reqs__custom-row--retired'}`}>
                <span className="reqs__custom-name">{c.label}</span>
                <span className="caption">{c.valid_months ? `Valid ${c.valid_months} months` : 'Does not expire'}{c.active ? '' : ' · retired'}</span>
                <button type="button" className="linklike" disabled={busy} onClick={() => void retireCustom(c.id, c.active)}>{c.active ? 'Retire' : 'Bring back'}</button>
              </li>
            ))}
          </ul>
        )}
        <div className="reqs__form reqs__form--two">
          <label className="reqs__field">
            <span className="caption">Name</span>
            <input className="field field--sm" value={label} placeholder="KBS site induction" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="reqs__field">
            <span className="caption">Valid for (months) · blank if it does not expire</span>
            <input className="field field--sm" type="number" min={1} max={120} value={months} placeholder="—" onChange={(e) => setMonths(e.target.value)} />
          </label>
          <button type="button" className="button button--quiet reqs__button" disabled={busy || !label.trim()} onClick={() => void addCustom()}>Add competency</button>
        </div>
      </section>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
