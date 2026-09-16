'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Props {
  projectId: string;
  planId: string;
  today: string;
}

/**
 * Record a drill against the plan in force. What it tested, how many took part,
 * how long the muster took if it was timed, and what to fix — the evidence ISO
 * 45001 cl. 8.2 asks for. A number that was not measured stays blank.
 */
export function DrillForm({ projectId, planId, today }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [heldOn, setHeldOn] = useState(today);
  const [scenario, setScenario] = useState('');
  const [participants, setParticipants] = useState('');
  const [minutes, setMinutes] = useState('');
  const [wentWell, setWentWell] = useState('');
  const [toImprove, setToImprove] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!scenario.trim()) { setError('Say what the drill tested.'); return; }
    const p = participants.trim() === '' ? null : Number(participants);
    const m = minutes.trim() === '' ? null : Number(minutes);
    if (p != null && (!Number.isInteger(p) || p < 0)) { setError('Participants is a whole number, or leave it blank.'); return; }
    if (m != null && (!Number.isFinite(m) || m < 0)) { setError('Muster time is in minutes, or leave it blank if it was not timed.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await createClient().from('emergency_drills').insert({
        project_id: projectId, plan_id: planId, held_on: heldOn, scenario: scenario.trim(),
        participants: p, muster_minutes: m,
        went_well: wentWell.trim() || null, to_improve: toImprove.trim() || null,
      });
      if (e) throw new Error(e.message);
      setOpen(false); setScenario(''); setParticipants(''); setMinutes(''); setWentWell(''); setToImprove('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The drill did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Record a drill</button>;
  }

  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      <p className="label">Record a drill</p>
      {error && <p className="alert" role="alert">{error}</p>}
      <label className="fieldcell">
        <span className="label">Held on</span>
        <input className="field field--sm" id="dr-held" type="date" value={heldOn} max={today} onChange={(e) => setHeldOn(e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">What it tested</span>
        <input className="field field--sm" id="dr-scenario" value={scenario} placeholder="Full evacuation, unannounced; fuel spill at the trailer" onChange={(e) => setScenario(e.target.value)} />
      </label>
      <div className="signin__grid">
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Took part</span>
          <input className="field field--sm" id="dr-people" inputMode="numeric" value={participants} placeholder="—" onChange={(e) => setParticipants(e.target.value)} />
        </label>
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Muster time (min)</span>
          <input className="field field--sm" id="dr-minutes" inputMode="decimal" value={minutes} placeholder="Not timed" onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      <label className="fieldcell">
        <span className="label">Went well</span>
        <textarea className="field field--sm" id="dr-well" rows={2} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">To improve</span>
        <textarea className="field field--sm" id="dr-improve" rows={2} value={toImprove} placeholder="Horn not heard at the far end of the batter" onChange={(e) => setToImprove(e.target.value)} />
      </label>
      <button type="button" className="button" disabled={busy || !scenario.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Record the drill'}</button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
      <p className="caption">Once saved it cannot be changed.</p>
    </div>
  );
}
