'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface PlantRow {
  id: string;
  item: string;
  hire_type: string | null;
  supplier: string | null;
  active: boolean;
  aliases: string[];
}

/**
 * The plant list. Machines the entry screen offers as a dropdown, with the
 * hire type and supplier if you set them. Hiding one never changes a day
 * already recorded.
 */
export function PlantList({ projectId, initial, canEdit }: { projectId: string; initial: PlantRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState<PlantRow[]>(initial);
  const [item, setItem] = useState('');
  const [hire, setHire] = useState('');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = item.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from('plant_list')
        .insert({ project_id: projectId, item: trimmed, hire_type: hire || null, supplier: supplier.trim() || null, sort_order: rows.length + 1 })
        .select('id, item, hire_type, supplier, active, aliases')
        .single();
      if (insertError) throw new Error(/duplicate/i.test(insertError.message) ? `${trimmed} is already on the list.` : insertError.message);
      setRows([...rows, data as PlantRow]);
      setItem(''); setHire(''); setSupplier('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(row: PlantRow, change: Partial<PlantRow>) {
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from('plant_list').update(change).eq('id', row.id);
    if (updateError) { setError(updateError.message); return; }
    setRows(rows.map((r) => (r.id === row.id ? { ...r, ...change } : r)));
  }

  async function remove(row: PlantRow) {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from('plant_list').delete().eq('id', row.id);
    if (deleteError) { setError(deleteError.message); return; }
    setRows(rows.filter((r) => r.id !== row.id));
  }

  return (
    <section className="crewlist">
      <p className="label">Plant list</p>
      <p className="way-hint" style={{ marginTop: '0.25rem' }}>
        The machines the entry screen offers when you add plant. Set the hire type and
        supplier here once and they come through with every pick. Hiding one never changes
        a day already recorded.
      </p>

      {rows.length === 0 && <p className="claims-nil">No plant on the list yet.</p>}

      {rows.map((row) => (
        <div key={row.id} className={`crewrow${row.active ? '' : ' crewrow--off'}`}>
          <div className="crewrow__who">
            <span className="crewrow__name">{row.item}</span>
            {canEdit ? (
              <>
                <select className="field field--sm crewrow__hire" value={row.hire_type ?? ''}
                  onChange={(e) => void patch(row, { hire_type: e.target.value || null })}>
                  <option value="">Hire —</option>
                  <option value="wet">Wet</option>
                  <option value="dry">Dry</option>
                </select>
                <input className="field field--sm crewrow__role" value={row.supplier ?? ''} placeholder="Supplier"
                  onChange={(e) => setRows(rows.map((r) => (r.id === row.id ? { ...r, supplier: e.target.value } : r)))}
                  onBlur={(e) => { if ((e.target.value.trim() || null) !== (initial.find((r) => r.id === row.id)?.supplier ?? null)) void patch(row, { supplier: e.target.value.trim() || null }); }} />
              </>
            ) : (
              <span className="crewrow__rolestatic">{[row.hire_type ? `${row.hire_type} hire` : null, row.supplier].filter(Boolean).join(' · ') || '—'}</span>
            )}
          </div>
          {canEdit && (
            <div className="crewrow__actions">
              <button type="button" className="quotebtn" onClick={() => void patch(row, { active: !row.active })}>{row.active ? 'Hide' : 'Show'}</button>
              <button type="button" className="quotebtn quotebtn--remove" onClick={() => void remove(row)}>Remove</button>
            </div>
          )}
          {canEdit ? (
            <label className="crewrow__aka">
              <span className="label">Also known as</span>
              <input
                className="field field--sm"
                defaultValue={(row.aliases ?? []).join(', ')}
                placeholder="the digger, 1.8 ton excavator — what the recording might call it"
                onBlur={(e) => {
                  const next = e.target.value.split(/[,;]+/).map((v) => v.trim()).filter(Boolean);
                  if (next.join('|') !== (row.aliases ?? []).join('|')) void patch(row, { aliases: next });
                }}
              />
            </label>
          ) : (row.aliases ?? []).length > 0 ? (
            <p className="crewrow__akastatic">also {row.aliases.join(', ')}</p>
          ) : null}
        </div>
      ))}

      {canEdit && (
        <div className="crewadd crewadd--plant">
          <input className="field field--sm" value={item} placeholder="Machine (Vac Truck, 1.8t Excavator…)" onChange={(e) => setItem(e.target.value)} />
          <select className="field field--sm" value={hire} onChange={(e) => setHire(e.target.value)}>
            <option value="">Hire —</option>
            <option value="wet">Wet</option>
            <option value="dry">Dry</option>
          </select>
          <input className="field field--sm" value={supplier} placeholder="Supplier" onChange={(e) => setSupplier(e.target.value)} />
          <button type="button" className="button button--quiet" style={{ marginTop: 0 }} disabled={busy || !item.trim()} onClick={add}>
            {busy ? 'Adding…' : 'Add to the list'}
          </button>
        </div>
      )}
      {error && <p className="alert">{error}</p>}
    </section>
  );
}
