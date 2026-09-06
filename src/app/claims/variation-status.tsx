'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { STATUS_HINT, STATUS_LABEL, VARIATION_STATUSES, type VariationStatus } from '@/lib/claims/register';

/**
 * Where a variation stands, and the control that moves it. Every change goes
 * through set_variation_status(), which records who, when and the note — the
 * screen never writes the row itself.
 */
export function VariationStatusControl({
  registerId,
  status,
  vrRef,
  agreedCost,
  notes,
}: {
  registerId: string;
  status: VariationStatus;
  vrRef: string | null;
  agreedCost: number | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ vrRef: vrRef ?? '', agreedCost: agreedCost == null ? '' : String(agreedCost), notes: notes ?? '' });

  async function move(next: VariationStatus) {
    if (next === status) return;
    const note = window.prompt(`${STATUS_LABEL[next]} — add a note for the record? (optional)`, '') ?? null;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc('set_variation_status', {
        p_register_id: registerId,
        p_status: next,
        p_note: note && note.trim() ? note.trim() : null,
      });
      if (rpcError) throw new Error(rpcError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    setBusy(true);
    setError(null);
    try {
      const cost = draft.agreedCost.trim() === '' ? null : Number(draft.agreedCost.replace(/[$,\s]/g, ''));
      if (cost != null && !Number.isFinite(cost)) throw new Error('Agreed value has to be a number.');
      const { error: rpcError } = await createClient().rpc('set_variation_details', {
        p_register_id: registerId,
        p_vr_ref: draft.vrRef.trim() || null,
        p_agreed_cost: cost,
        p_notes: draft.notes.trim() || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those details did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vr-control">
      <select
        className="field field--sm vr-select"
        value={status}
        disabled={busy}
        aria-label="Variation status"
        title={STATUS_HINT[status]}
        onChange={(e) => void move(e.target.value as VariationStatus)}
      >
        {VARIATION_STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>
      <button className="linklike" type="button" disabled={busy} onClick={() => setEditing((v) => !v)}>
        {editing ? 'Close' : 'Details'}
      </button>
      {editing && (
        <div className="vr-details">
          <label className="fieldcell">
            <span className="label">VR ref</span>
            <input className="field field--sm" value={draft.vrRef} placeholder="VR-012"
              onChange={(e) => setDraft({ ...draft, vrRef: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Agreed value ($)</span>
            <input className="field field--sm" inputMode="decimal" value={draft.agreedCost} placeholder="unknown"
              onChange={(e) => setDraft({ ...draft, agreedCost: e.target.value })} />
          </label>
          <label className="fieldcell">
            <span className="label">Notes</span>
            <textarea className="field" rows={2} value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          <button className="button button--outline" type="button" disabled={busy} onClick={saveDetails}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
        </div>
      )}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}

/**
 * Only offered for an item no diary mentions any more and no signed day
 * stands behind — the supervisor took the variation out of the draft. The
 * database refuses it for anything else.
 */
export function RemoveVariationButton({ registerId, number }: { registerId: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!window.confirm(`Remove ${number} from the register? It is not in any diary.`)) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc('remove_variation_item', { p_register_id: registerId });
      if (rpcError) throw new Error(rpcError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="linklike linklike--danger" type="button" disabled={busy} onClick={remove}>
        {busy ? 'Removing…' : 'Remove from register'}
      </button>
      {error && <p className="alert">{error}</p>}
    </>
  );
}
