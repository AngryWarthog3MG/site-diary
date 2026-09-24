'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { STATUS_LABEL, type VariationStatus } from '@/lib/claims/register';

export interface RegisterRow {
  id: string;
  seq: number;
  title: string;
  status: VariationStatus;
  estimated_cost: number | null;
  agreed_cost: number | null;
  vr_ref: string | null;
  notes: string | null;
}

const money = (n: number | null) => (n == null ? null : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[$,\s]/g, '')));

/**
 * The register item behind a day's variation, on the Variations tab
 * (README R100). The day carries only the number; what the variation is
 * called, what it is expected to be worth, what was agreed and the client's
 * reference live on the register — so this panel shows them where the
 * supervisor is looking, and lets a register keeper set them without leaving
 * the day. Saves go through the register's own RPCs; nothing here touches
 * the day's row or the signed record.
 */
export function VariationRegisterPanel({ row, canManage, onChanged }: { row: RegisterRow | null; canManage: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', vrRef: '', estimated: '', agreed: '', notes: '' });

  if (!row) return null;
  const begin = () => {
    setDraft({ title: row.title, vrRef: row.vr_ref ?? '', estimated: row.estimated_cost == null ? '' : String(row.estimated_cost), agreed: row.agreed_cost == null ? '' : String(row.agreed_cost), notes: row.notes ?? '' });
    setError(null); setOpen(true);
  };
  async function save() {
    const estimated = num(draft.estimated); const agreed = num(draft.agreed);
    if (!draft.title.trim()) { setError('The variation needs a name.'); return; }
    if ((estimated != null && !Number.isFinite(estimated)) || (agreed != null && !Number.isFinite(agreed))) { setError('A value is a number of dollars.'); return; }
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      if (draft.title.trim() !== row!.title) {
        const { error: e1 } = await supabase.rpc('update_variation_register', { p_register_id: row!.id, p_title: draft.title, p_vr_ref: draft.vrRef || null });
        if (e1) throw new Error(e1.message);
      }
      const { error: e2 } = await supabase.rpc('set_variation_details', {
        p_register_id: row!.id, p_vr_ref: draft.vrRef || null, p_agreed_cost: agreed, p_notes: draft.notes || null, p_estimated_cost: estimated, p_keep_estimate: false,
      });
      if (e2) throw new Error(e2.message);
      setOpen(false);
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="vreg">
      <p className="vreg__line">
        <span className="mono">V-{String(row.seq).padStart(3, '0')}</span> {row.title}
        <span className="vreg__facts"> · {STATUS_LABEL[row.status] ?? row.status}
          {row.agreed_cost != null ? ` · agreed ${money(row.agreed_cost)}` : row.estimated_cost != null ? ` · est. ${money(row.estimated_cost)}` : ' · no value yet'}
          {row.vr_ref ? ` · ${row.vr_ref}` : ''}
        </span>
        {canManage && !open && <button type="button" className="linklike vreg__edit" onClick={begin}>{row.agreed_cost == null && row.estimated_cost == null ? 'Price it' : 'Edit'}</button>}
      </p>
      {open && (
        <div className="item vreg__form">
          <label className="fieldcell"><span className="label">Name on the register</span>
            <input className="field field--sm" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Estimated value ($)</span>
              <input className="field field--sm" inputMode="decimal" value={draft.estimated} placeholder="e.g. 4200" onChange={(e) => setDraft({ ...draft, estimated: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Agreed value ($)</span>
              <input className="field field--sm" inputMode="decimal" value={draft.agreed} placeholder="once the client agrees" onChange={(e) => setDraft({ ...draft, agreed: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Client&rsquo;s reference</span>
              <input className="field field--sm" value={draft.vrRef} placeholder="VR-012" onChange={(e) => setDraft({ ...draft, vrRef: e.target.value })} /></label>
          </div>
          <label className="fieldcell"><span className="label">Notes</span>
            <input className="field field--sm" value={draft.notes} placeholder="Rates, basis, who said what" onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          {error && <p className="alert">{error}</p>}
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save to the register'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="caption">Saved on the register, not on this day: the day keeps the number, the crew and the hours; the price is agreed once.</p>
        </div>
      )}
    </div>
  );
}
