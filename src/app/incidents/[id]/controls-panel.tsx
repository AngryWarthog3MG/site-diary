'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtPerthDate } from '@/lib/pdf/dates';
import {
  CONTROL_LEVELS, CONTROL_LEVEL_LABEL, CONTROL_LEVEL_SHORT, CONTROL_STATUS_LABEL, CONTROL_STATE_LABEL,
  controlState, sortControls, hazardTypeLabel, type ControlLevel, type ControlStatus,
} from '@/lib/incidents/controls';

export interface ControlView {
  id: string; level: ControlLevel; description: string; status: ControlStatus; created_by: string; created_at: string;
  in_place_at: string | null; withdrawn_at: string | null; withdrawn_reason: string | null; by: string;
}

interface Props {
  incidentId: string; projectId: string; kind: string; status: string; hazardType: string | null; critical: boolean;
  hazardTypes: Array<{ kind: string; key: string; label: string }>;
  controls: ControlView[]; canRunTalks: boolean; canManage: boolean; userId: string;
}

/**
 * The controls on a hazard (README R179): each on the hierarchy, planned or in place, withdrawn only with a reason.
 * The hazard's state is read off them. Adding and moving a control works with no signal through the outbox,
 * ids chosen here; the database stamps the time it went in.
 */
export function ControlsPanel({ incidentId, projectId, kind, status, hazardType, critical, hazardTypes, controls, canRunTalks, canManage, userId }: Props) {
  const router = useRouter();
  const pendingAdds = usePending('hazard_control', incidentId);
  const pendingMoves = usePending('hazard_control_update', incidentId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<ControlLevel>('engineering');
  const [description, setDescription] = useState('');
  const [inPlaceNow, setInPlaceNow] = useState(true);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const closed = status === 'closed';
  const state = controlState(controls);
  const isHazard = kind === 'hazard';

  async function run(label: string, fn: () => Promise<'sent' | 'queued' | void>) {
    setBusy(label); setError(null);
    try {
      const outcome = await fn();
      // A save kept on the phone never refreshes the page (README R78).
      if (outcome !== 'queued') router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const add = () => run('add the control', async () => {
    if (!description.trim()) throw new Error('Say what the control is.');
    const id = outbox.newId();
    const at = new Date().toISOString();
    const row = { incident_id: incidentId, level, description: description.trim(), status: inPlaceNow ? 'in_place' : 'planned', created_by: userId, created_on_device_at: at };
    const live = async () => {
      const { error: e } = await createClient().from('hazard_controls').insert({ id, ...row });
      if (e) throw new Error(e.message);
    };
    const queue = () => outbox.enqueue({ kind: 'hazard_control', projectId, subjectId: incidentId, payload: { id, row } }).then(() => undefined);
    const outcome = await runOrQueue(live, queue);
    setDescription('');
    return outcome;
  });
  const move = (c: ControlView, patch: { status: ControlStatus; withdrawn_reason?: string }) => run('move the control', async () => {
    if (patch.status === 'withdrawn' && !patch.withdrawn_reason?.trim()) throw new Error('Say why it was withdrawn.');
    const live = async () => {
      const { data, error: e } = await createClient().from('hazard_controls').update(patch).eq('id', c.id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('Not allowed from this account.');
    };
    const queue = () => outbox.enqueue({ kind: 'hazard_control_update', projectId, subjectId: incidentId, payload: { controlId: c.id, patch } }).then(() => undefined);
    const outcome = await runOrQueue(live, queue);
    setWithdrawing(null);
    return outcome;
  });
  const remove = (c: ControlView) => run('remove it', async () => {
    const { data, error: e } = await createClient().from('hazard_controls').delete().eq('id', c.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Only whoever planned it removes it, and only while it is planned.');
  });
  const setCritical = (v: boolean) => run('set the critical flag', async () => {
    const { data, error: e } = await createClient().from('incidents').update({ critical_risk: v }).eq('id', incidentId).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });

  const pending = pendingAdds.length + pendingMoves.length;
  return (
    <div className="item">
      <p className="label">
        Controls{isHazard ? <> · <span className={state === 'no_controls' || state === 'control_pending' ? 'vr-missing' : ''}>{CONTROL_STATE_LABEL[state]}</span></> : ''}
        {critical ? ' · CRITICAL RISK' : ''}
      </p>
      {(hazardType || canManage) && (
        <p className="incident__meta">
          {hazardType ? <>Hazard type: {hazardTypeLabel(hazardType, hazardTypes)}</> : null}
          {canManage && !closed && (
            <> {hazardType ? '· ' : ''}<label><input type="checkbox" checked={critical} disabled={busy != null} onChange={(e) => void setCritical(e.target.checked)} /> Critical risk — could kill or maim; controls are checked before work goes on</label></>
          )}
        </p>
      )}
      {pending > 0 && <p className="caption">{pending} control change{pending === 1 ? '' : 's'} waiting to send.</p>}
      {controls.length === 0 && <p className="nil">{isHazard ? 'No controls recorded. Until one is in place this hazard is open and uncontrolled.' : 'No controls recorded.'}</p>}
      {sortControls(controls).map((c) => (
        <div key={c.id} className={`incident__action${c.status === 'withdrawn' ? ' incident__action--done' : ''}`}>
          <div>
            <p className="incident__text"><strong>{CONTROL_LEVEL_SHORT[c.level]}</strong> · {c.description}</p>
            <p className="caption">
              {CONTROL_STATUS_LABEL[c.status]}
              {c.status === 'in_place' && c.in_place_at ? ` since ${fmtPerthDate(c.in_place_at)}` : ''}
              {c.status === 'withdrawn' && c.withdrawn_at ? ` ${fmtPerthDate(c.withdrawn_at)}${c.withdrawn_reason ? ` — ${c.withdrawn_reason}` : ''}` : ''}
              {` · ${c.by}`}
            </p>
            {withdrawing === c.id && (
              <div className="signin__grid">
                <input className="field field--sm" placeholder="Why it was withdrawn" value={reason[c.id] ?? ''} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} />
                <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void move(c, { status: 'withdrawn', withdrawn_reason: reason[c.id] ?? '' })}>Withdraw</button>
                <button type="button" className="linklike" onClick={() => setWithdrawing(null)}>Cancel</button>
              </div>
            )}
          </div>
          {canRunTalks && !closed && withdrawing !== c.id && (
            <div className="signin__actions">
              {c.status === 'planned' && <button type="button" className="button button--quiet signin__out" disabled={busy != null} onClick={() => void move(c, { status: 'in_place' })}>In place</button>}
              {c.status === 'planned' && c.created_by === userId && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void remove(c)}>Remove</button>}
              {c.status === 'in_place' && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => setWithdrawing(c.id)}>Withdraw</button>}
            </div>
          )}
        </div>
      ))}
      {canRunTalks && !closed && (
        <div className="incident__add">
          <label className="fieldcell"><span className="label">New control</span>
            <input className="field field--sm" value={description} placeholder="What is, or will be, in place" onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">On the hierarchy</span>
            <select className="field field--sm" value={level} onChange={(e) => setLevel(e.target.value as ControlLevel)}>
              {CONTROL_LEVELS.map((l) => <option key={l} value={l}>{CONTROL_LEVEL_LABEL[l]}</option>)}
            </select></label>
          <label className={`checkrow${inPlaceNow ? ' checkrow--on' : ''}`}>
            <input type="checkbox" checked={inPlaceNow} onChange={(e) => setInPlaceNow(e.target.checked)} />
            <span>In place now (untick to plan it)</span>
          </label>
          <button type="button" className="button button--quiet" disabled={busy != null || !description.trim()} onClick={() => void add()}>{busy === 'add the control' ? 'Saving…' : 'Add the control'}</button>
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
