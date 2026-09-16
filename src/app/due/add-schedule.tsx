'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PRESETS, KIND_LABEL, OBLIGATION_KINDS, type ObligationKind } from '@/lib/obligations/model';

interface Props {
  orgId: string;
  projectId: string;
  userId: string;
  today: string;
  /** Only an organisation's crew managers may set a company-wide schedule. */
  isAdmin: boolean;
}

/**
 * Set up something that falls due on a cycle. The presets carry the clause
 * that asks for each one, because "why is this due" is the first thing an
 * auditor reads; every field stays editable, since a principal's contract can
 * set a tighter interval than the standard's "planned intervals".
 */
export function AddSchedule({ orgId, projectId, userId, today, isAdmin }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ObligationKind>('internal_audit');
  const [title, setTitle] = useState('');
  const [basis, setBasis] = useState('');
  const [interval, setIntervalMonths] = useState('3');
  const [firstDue, setFirstDue] = useState(today);
  const [scope, setScope] = useState<'project' | 'org'>('project');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(i: number) {
    const p = PRESETS[i];
    setKind(p.kind);
    setTitle(p.title);
    setBasis(p.basis);
    setIntervalMonths(p.intervalMonths == null ? '' : String(p.intervalMonths));
    setScope(p.scope === 'org' && isAdmin ? 'org' : 'project');
    setOpen(true);
  }

  async function save() {
    if (!title.trim()) { setError('Give it a name.'); return; }
    const months = interval.trim() === '' ? null : Number(interval);
    if (months != null && (!Number.isInteger(months) || months < 1 || months > 120)) { setError('The interval is a whole number of months, 1 to 120, or blank for once.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await createClient().from('obligations').insert({
        org_id: orgId,
        project_id: scope === 'org' ? null : projectId,
        kind, title: title.trim(), basis: basis.trim() || null,
        interval_months: months, first_due_on: firstDue,
        created_by: userId,
      });
      if (e) throw new Error(e.message);
      setOpen(false); setTitle(''); setBasis('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: '1.25rem' }}>
      <hr className="rule" />
      <p className="label">Add a schedule</p>
      <div className="crewchips">
        {PRESETS.map((p, i) => (p.scope === 'org' && !isAdmin ? null : (
          <button key={p.title} type="button" className="quotebtn crewchip" onClick={() => applyPreset(i)}>{p.title}</button>
        )))}
        <button type="button" className="quotebtn crewchip" onClick={() => { setTitle(''); setBasis(''); setKind('other'); setOpen(true); }}>Something else</button>
      </div>

      {open && (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          {error && <p className="alert" role="alert">{error}</p>}
          <label className="fieldcell">
            <span className="label">What it is</span>
            <input className="field field--sm" id="ob-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">Kind</span>
              <select className="field field--sm" id="ob-kind" value={kind} onChange={(e) => setKind(e.target.value as ObligationKind)}>
                {OBLIGATION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="fieldcell fieldcell--narrow">
              <span className="label">Every (months)</span>
              <input className="field field--sm" id="ob-interval" inputMode="numeric" value={interval} placeholder="Once" onChange={(e) => setIntervalMonths(e.target.value)} />
            </label>
          </div>
          <label className="fieldcell">
            <span className="label">Why it is due</span>
            <input className="field field--sm" id="ob-basis" value={basis} placeholder="The clause, regulation or contract that asks for it" onChange={(e) => setBasis(e.target.value)} />
          </label>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">First due</span>
              <input className="field field--sm" id="ob-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
            </label>
            {isAdmin && (
              <label className="fieldcell">
                <span className="label">For</span>
                <select className="field field--sm" id="ob-scope" value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'org')}>
                  <option value="project">This job</option>
                  <option value="org">The whole company</option>
                </select>
              </label>
            )}
          </div>
          <button type="button" className="button" disabled={busy || !title.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save the schedule'}
          </button>
          <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </section>
  );
}
