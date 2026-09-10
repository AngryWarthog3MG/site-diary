'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PLANT_KINDS, PLANT_KIND_LABEL, OWNERSHIP_LABEL, type PlantKind, type Ownership } from '@/lib/plant/checklist';

export interface RegisterRow {
  id: string; name: string; kind: string; make_model: string | null; plant_no: string | null;
  ownership: string; supplier: string | null; active: boolean;
}

/** Add a machine to the fleet, or retire one. Used on the Plant page and inline from the checklist. */
export function AddPlantForm({ orgId, onAdded, compact }: { orgId: string; onAdded: (row: RegisterRow) => void; compact?: boolean }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlantKind>('excavator');
  const [plantNo, setPlantNo] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [ownership, setOwnership] = useState<Ownership>('own');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the machine a name.'); return; }
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('plant_register')
        .insert({ org_id: orgId, name: trimmed, kind, plant_no: plantNo.trim() || null, make_model: makeModel.trim() || null, ownership, supplier: supplier.trim() || null, created_by: auth.user?.id })
        .select('id, name, kind, make_model, plant_no, ownership, supplier, active')
        .single();
      if (insertError) throw new Error(/duplicate|unique/i.test(insertError.message) ? `${trimmed}${plantNo ? ` (${plantNo})` : ''} is already on the register.` : insertError.message);
      onAdded(data as RegisterRow);
      setName(''); setPlantNo(''); setMakeModel(''); setSupplier('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally { setBusy(false); }
  }

  return (
    <div className={`addplant${compact ? ' addplant--compact' : ''}`}>
      <div className="photo-add-pair">
        <label className="fieldcell" style={{ flex: 2 }}>
          <span className="label">Machine</span>
          <input className="field field--sm" value={name} placeholder="1.8t Excavator" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="fieldcell" style={{ flex: 1 }}>
          <span className="label">Plant no / rego</span>
          <input className="field field--sm" value={plantNo} placeholder="KBS-01" onChange={(e) => setPlantNo(e.target.value)} />
        </label>
      </div>
      <div className="photo-add-pair">
        <label className="fieldcell" style={{ flex: 1 }}>
          <span className="label">Type of checklist</span>
          <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as PlantKind)}>
            {PLANT_KINDS.map((k) => <option key={k} value={k}>{PLANT_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="fieldcell" style={{ flex: 1 }}>
          <span className="label">Ownership</span>
          <select className="field field--sm" value={ownership} onChange={(e) => setOwnership(e.target.value as Ownership)}>
            {(Object.keys(OWNERSHIP_LABEL) as Ownership[]).map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
          </select>
        </label>
      </div>
      {!compact && (
        <div className="photo-add-pair">
          <label className="fieldcell" style={{ flex: 1 }}>
            <span className="label">Make / model</span>
            <input className="field field--sm" value={makeModel} placeholder="Kubota U17" onChange={(e) => setMakeModel(e.target.value)} />
          </label>
          <label className="fieldcell" style={{ flex: 1 }}>
            <span className="label">Supplier (if hired)</span>
            <input className="field field--sm" value={supplier} placeholder="Coates" onChange={(e) => setSupplier(e.target.value)} />
          </label>
        </div>
      )}
      {error && <p className="alert">{error}</p>}
      <button className="button button--outline" type="button" disabled={busy} onClick={add}>
        {busy ? 'Adding…' : 'Add to the register'}
      </button>
    </div>
  );
}

export function PlantRegister({ orgId, projectId, initial, onJob: initialOnJob, canEdit }: {
  orgId: string; projectId: string; initial: RegisterRow[]; onJob: string[]; canEdit: boolean;
}) {
  const [rows, setRows] = useState<RegisterRow[]>(initial);
  const [onJob, setOnJob] = useState<Set<string>>(new Set(initialOnJob));
  const [error, setError] = useState<string | null>(null);

  /** Which of the fleet is on this job. The diary's vocabulary reads this. */
  async function setOnThisJob(row: RegisterRow, on: boolean) {
    setError(null);
    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from('project_plant')
      .upsert({ project_id: projectId, plant_id: row.id, active: on, sort_order: rows.findIndex((r) => r.id === row.id) + 1 }, { onConflict: 'project_id,plant_id' });
    if (upsertError) { setError(upsertError.message); return; }
    setOnJob((prev) => { const next = new Set(prev); if (on) next.add(row.id); else next.delete(row.id); return next; });
  }

  async function setActive(row: RegisterRow, active: boolean) {
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from('plant_register').update({ active }).eq('id', row.id);
    if (updateError) { setError(updateError.message); return; }
    setRows(rows.map((r) => (r.id === row.id ? { ...r, active } : r)));
  }

  return (
    <div className="plantreg">
      {rows.length === 0 && <p className="caption">Nothing on the register yet.</p>}
      <ul className="plantreg__list">
        {rows.map((r) => (
          <li key={r.id} className={r.active ? '' : 'plantreg__retired'}>
            <div>
              <p className="machine__name">{r.name}{r.plant_no ? <span className="mono"> · {r.plant_no}</span> : null}</p>
              <p className="machine__meta">
                {[PLANT_KIND_LABEL[r.kind as PlantKind] ?? r.kind, r.make_model, OWNERSHIP_LABEL[r.ownership as Ownership] ?? r.ownership, r.supplier].filter(Boolean).join(' · ')}
                {!r.active ? ' · retired' : ''}
              </p>
            </div>
            {canEdit && (
              <div className="plantreg__actions">
                {r.active && (
                  <label className={`checkrow checkrow--inline${onJob.has(r.id) ? ' checkrow--on' : ''}`}>
                    <input type="checkbox" checked={onJob.has(r.id)} onChange={(e) => void setOnThisJob(r, e.target.checked)} />
                    <span>On this job</span>
                  </label>
                )}
                <button type="button" className="quotebtn" onClick={() => void setActive(r, !r.active)}>
                  {r.active ? 'Retire' : 'Bring back'}
                </button>
              </div>
            )}
            {!canEdit && r.active && onJob.has(r.id) && <span className="status-pill status-pill--ready">On this job</span>}
          </li>
        ))}
      </ul>
      {error && <p className="alert">{error}</p>}
      {canEdit && <AddPlantForm orgId={orgId} onAdded={(row) => { setRows([...rows, row]); void setOnThisJob(row, true); }} />}
    </div>
  );
}
