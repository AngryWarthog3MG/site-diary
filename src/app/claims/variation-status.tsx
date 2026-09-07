'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { STATUS_HINT, STATUS_LABEL, VARIATION_STATUSES, type VariationStatus } from '@/lib/claims/register';
import { fmtDate } from '@/lib/pdf/dates';

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
  needsValue = false,
}: {
  registerId: string;
  status: VariationStatus;
  vrRef: string | null;
  agreedCost: number | null;
  notes: string | null;
  /** No figure anywhere yet: the Details link says so and opens ready to take one. */
  needsValue?: boolean;
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
      <button className={`linklike${needsValue && !editing ? ' linklike--amber' : ''}`} type="button" disabled={busy} onClick={() => setEditing((v) => !v)}>
        {editing ? 'Close' : needsValue ? 'Add a value' : 'Details'}
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
            <input className="field field--sm" inputMode="decimal" value={draft.agreedCost} placeholder="e.g. 2000" autoFocus={needsValue}
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

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${fmtDate(iso).slice(0, 5)}`;
}

/**
 * A variation that ran for days is recorded on each of them from here: pick
 * the open days, and the same variation is written into those drafts as you,
 * to be confirmed on each day's review before it is signed. Only your own
 * unsigned days are offered; a day already carrying it is not.
 */
export function RecordOnDay({
  registerId,
  number,
  days,
}: {
  registerId: string;
  number: string;
  days: Array<{ entry_id: string; date: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      for (const id of picked) {
        const { error: rpcError } = await supabase.rpc('record_variation_on_day', { p_register_id: registerId, p_entry_id: id });
        if (rpcError) throw new Error(rpcError.message);
      }
      setOpen(false);
      setPicked(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vr-record">
      <button className="linklike" type="button" disabled={busy} onClick={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Record on another day'}
      </button>
      {open && (
        <div className="vr-record__days">
          <p className="label">Which days did {number} run?</p>
          {days.map((d) => (
            <label key={d.entry_id} className="vr-record__day">
              <input
                type="checkbox"
                checked={picked.has(d.entry_id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(d.entry_id); else next.delete(d.entry_id);
                  setPicked(next);
                }}
              />
              <span>{dayLabel(d.date)} <span className="vr-note" style={{ display: 'inline' }}>draft</span></span>
            </label>
          ))}
          <button className="button button--outline" type="button" disabled={busy || picked.size === 0} onClick={record}>
            {busy ? 'Recording…' : picked.size === 0 ? 'Pick the days' : `Record on ${picked.size} day${picked.size === 1 ? '' : 's'}`}
          </button>
          <p className="vr-note">It goes on each day’s review for you to confirm before that day is signed.</p>
        </div>
      )}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}
