'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';

export interface DefectRow { id: string; plant: string; item: string; note: string | null; raised: string }

/** Open defects, each closed with a word about what was done. */
export function DefectList({ initial, canClose }: { projectId: string; initial: DefectRow[]; canClose: boolean }) {
  const [rows, setRows] = useState(initial);
  const [closing, setClosing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function close(id: string) {
    setError(null);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from('plant_defects')
      .update({ closed_at: new Date().toISOString(), closed_by: auth.user?.id, closed_note: note.trim() || null })
      .eq('id', id);
    if (updateError) { setError(updateError.message); return; }
    setRows(rows.filter((r) => r.id !== id));
    setClosing(null); setNote('');
  }

  if (rows.length === 0) return <p className="caption">Nothing open. Every defect raised has been closed.</p>;
  return (
    <ul className="defects">
      {rows.map((d) => (
        <li key={d.id} className="defect">
          <div>
            <p className="machine__name">{d.plant} · {d.item}</p>
            <p className="machine__meta">{d.note ? `${d.note} · ` : ''}raised {fmtDate(d.raised.slice(0, 10))}</p>
            {closing === d.id && (
              <div className="defect__close">
                <input className="field field--sm" value={note} placeholder="What was done — replaced hose, tagged out, sent for service…" onChange={(e) => setNote(e.target.value)} />
                <button className="button button--outline" type="button" onClick={() => void close(d.id)}>Close it</button>
              </div>
            )}
          </div>
          {canClose && closing !== d.id && (
            <button type="button" className="quotebtn" onClick={() => { setClosing(d.id); setNote(''); }}>Close</button>
          )}
        </li>
      ))}
      {error && <li><p className="alert">{error}</p></li>}
    </ul>
  );
}
