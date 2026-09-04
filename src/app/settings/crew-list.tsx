'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface CrewRow {
  id: string;
  name: string;
  role: string | null;
  active: boolean;
}

/**
 * The crew list. Names and roles the entry screen offers as a dropdown so a
 * normal day is picked, not typed. Taking someone off the list hides them
 * from the dropdown; it never touches a day already recorded.
 */
export function CrewList({ projectId, initial, canEdit }: { projectId: string; initial: CrewRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState<CrewRow[]>(initial);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from('crew')
        .insert({ project_id: projectId, name: trimmed, role: role.trim() || null, sort_order: rows.length + 1 })
        .select('id, name, role, active')
        .single();
      if (insertError) throw new Error(/duplicate/i.test(insertError.message) ? `${trimmed} is already on the list.` : insertError.message);
      setRows([...rows, data as CrewRow]);
      setName('');
      setRole('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(row: CrewRow, change: Partial<CrewRow>) {
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from('crew').update(change).eq('id', row.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setRows(rows.map((r) => (r.id === row.id ? { ...r, ...change } : r)));
  }

  async function remove(row: CrewRow) {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from('crew').delete().eq('id', row.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setRows(rows.filter((r) => r.id !== row.id));
  }

  return (
    <section className="crewlist">
      <p className="label">Crew list</p>
      <p className="way-hint" style={{ marginTop: '0.25rem' }}>
        The names and roles the entry screen offers when you add labour. Pick from the list
        instead of typing. Taking someone off never changes a day already recorded.
      </p>

      {rows.length === 0 && <p className="claims-nil">Nobody on the list yet.</p>}

      {rows.map((row) => (
        <div key={row.id} className={`crewrow${row.active ? '' : ' crewrow--off'}`}>
          <div className="crewrow__who">
            <span className="crewrow__name">{row.name}</span>
            {canEdit ? (
              <input
                className="field field--sm crewrow__role"
                value={row.role ?? ''}
                placeholder="Role"
                onChange={(e) => setRows(rows.map((r) => (r.id === row.id ? { ...r, role: e.target.value } : r)))}
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (initial.find((r) => r.id === row.id)?.role ?? null)) void patch(row, { role: e.target.value.trim() || null }); }}
              />
            ) : (
              <span className="crewrow__rolestatic">{row.role ?? '—'}</span>
            )}
          </div>
          {canEdit && (
            <div className="crewrow__actions">
              <button type="button" className="quotebtn" onClick={() => void patch(row, { active: !row.active })}>
                {row.active ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="quotebtn quotebtn--remove" onClick={() => void remove(row)}>
                Remove
              </button>
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="crewadd">
          <input className="field field--sm" value={name} placeholder="Name" onChange={(e) => setName(e.target.value)} />
          <input className="field field--sm" value={role} placeholder="Role (Labourer, Machine Op…)" onChange={(e) => setRole(e.target.value)} />
          <button type="button" className="button button--quiet" style={{ marginTop: 0 }} disabled={busy || !name.trim()} onClick={add}>
            {busy ? 'Adding…' : 'Add to the list'}
          </button>
        </div>
      )}
      {error && <p className="alert">{error}</p>}
    </section>
  );
}
