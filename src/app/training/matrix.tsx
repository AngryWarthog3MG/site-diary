'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { compressPhoto } from '@/lib/photos/compress';
import { fmtDate } from '@/lib/pdf/dates';
import type { MatrixRow, Competency } from '@/lib/training/model';

interface Props { rows: MatrixRow[]; columns: Competency[]; allCompetencies: Competency[]; orgId: string; projectId: string; userId: string; canManage: boolean; today: string }

const MARK: Record<string, string> = { current: '●', expiring: '◔', expired: '✕', missing: '·' };

/** The grid, and a small form to record a ticket straight into a cell. */
export function Matrix({ rows, columns, allCompetencies, orgId, projectId, userId, canManage, today }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState<{ person: string; key: string } | null>(null);
  const [no, setNo] = useState(''); const [issued, setIssued] = useState(''); const [expires, setExpires] = useState(''); const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function save() {
    if (!adding) return;
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      // The row first, so a photo never sits in storage with nothing pointing at it (the tickets screen does the same).
      const { error: e } = await supabase.from('crew_tickets').insert({ id, org_id: orgId, person_name: adding.person, ticket_type: adding.key, ticket_no: no.trim() || null, issued_on: issued || null, expires_on: expires || null, created_by: userId });
      if (e) throw new Error(e.message);
      if (photo) {
        const c = await compressPhoto(photo);
        const path = `${orgId}/${id}.${c.extension}`;
        const { error: upErr } = await supabase.storage.from('crew-tickets').upload(path, c.blob, { contentType: c.contentType, upsert: false });
        if (!upErr) await supabase.from('crew_tickets').update({ photo_path: path }).eq('id', id);
        else setError(`Saved; the photo did not upload: ${upErr.message}`);
      }
      setAdding(null); setNo(''); setIssued(''); setExpires(''); setPhoto(null);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(false); }
  }

  if (rows.length === 0) return <p className="nil">Nobody on the crew list yet.</p>;
  return (
    <div className="matrix">
      <div className="matrix__scroll">
        <table className="matrix__table">
          <thead>
            <tr><th className="matrix__person">Person</th>{columns.map((c) => <th key={c.key} className="matrix__col"><span>{c.label}</span></th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.gaps.length ? 'matrix__row--gap' : ''}>
                <td className="matrix__person">
                  <button type="button" className="linklike" onClick={() => setOpen(open === r.name ? null : r.name)}><strong>{r.name}</strong></button>
                  <br /><span className="caption">{r.role ?? 'no role'}{r.gaps.length ? ` · ${r.gaps.length} gap${r.gaps.length === 1 ? '' : 's'}` : ''}</span>
                </td>
                {columns.map((c) => {
                  const cell = r.cells[c.key];
                  const cls = `matrix__cell matrix__cell--${cell.state}${cell.required ? ' matrix__cell--required' : ''}`;
                  return (
                    <td key={c.key} className={cls} title={`${c.label}: ${cell.state}${cell.expires_on ? ` · ${fmtDate(cell.expires_on)}` : ''}${cell.required ? ' · required' : ''}`}>
                      {canManage && (cell.state === 'missing' || cell.state === 'expired' || cell.state === 'expiring') ? (
                        <button type="button" className="matrix__mark" onClick={() => setAdding({ person: r.name, key: c.key })}>{MARK[cell.state]}</button>
                      ) : <span className="matrix__mark">{MARK[cell.state]}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">● current · ◔ expiring within 30 days · ✕ expired · · none recorded · red cell = required by the role and not held{canManage ? ' · tap a cell to record a ticket' : ''}</p>
      {open && (() => {
        const r = rows.find((x) => x.name === open)!;
        return (
          <div className="item">
            <p className="label">{r.name}{r.role ? ` · ${r.role}` : ''}</p>
            {r.gaps.length > 0 && <p className="vr-missing">Gaps: {r.gaps.join(', ')}</p>}
            {r.expiring.length > 0 && <p>Expiring: {r.expiring.join(', ')}</p>}
            <p className="caption">Held: {allCompetencies.filter((c) => r.cells[c.key]?.state === 'current' || r.cells[c.key]?.state === 'expiring').map((c) => `${c.label}${r.cells[c.key].expires_on ? ` (to ${fmtDate(r.cells[c.key].expires_on)})` : ''}`).join(', ') || 'nothing recorded'}</p>
            {canManage && (
              <div className="crewchips">{allCompetencies.filter((c) => r.cells[c.key]?.state !== 'current').map((c) => <button key={c.key} type="button" className="quotebtn crewchip" onClick={() => setAdding({ person: r.name, key: c.key })}>+ {c.label}</button>)}</div>
            )}
          </div>
        );
      })()}
      {adding && (
        <div className="item">
          <p className="label">Record: {allCompetencies.find((c) => c.key === adding.key)?.label} for {adding.person}</p>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Number</span><input className="field field--sm" value={no} onChange={(e) => setNo(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Issued</span><input className="field field--sm" type="date" value={issued} max={today} onChange={(e) => setIssued(e.target.value)} /></label>
          </div>
          <label className="fieldcell"><span className="label">Expires (blank if it does not)</span><input className="field field--sm" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">Photo of the card</span><input className="field field--sm" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="photo-add-pair">
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="button button--quiet" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && !adding && <p className="alert" role="alert">{error}</p>}
      <p className="caption">Tickets themselves are kept under Settings; this is the same list, laid out.</p>
      <a className="button button--quiet" href={`/api/training/pdf?project=${projectId}`} target="_blank" rel="noopener">Matrix PDF for this job</a>
    </div>
  );
}
