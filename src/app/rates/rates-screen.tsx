'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtMoney } from '@/lib/money';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { COST_KINDS, KIND_LABEL, KIND_UNIT, UNITS, norm, type CostKind, type RateItem } from '@/lib/variations/costs';

type Draft = { kind: CostKind; label: string; unit: string; rate: string; plant_id: string; notes: string; scope: 'company' | 'job' };
const blank = (kind: CostKind): Draft => ({ kind, label: '', unit: KIND_UNIT[kind], rate: '', plant_id: '', notes: '', scope: 'company' });
const per = (unit: string) => (unit === 'lump sum' ? '' : ` / ${unit}`);
const EXAMPLE: Record<CostKind, string> = { labour: 'Labourer', plant: 'Excavator 5t, wet hire', material: 'Road base', other: 'Traffic control' };

/**
 * The rate card, by kind. A company rate that this job replaces is shown under it, dimmed, so it is clear which
 * one a build-up here will use. Rates are never deleted — retired — and every change is kept in the database.
 */
export function RatesScreen({ orgId, projectId, projectCode, orgName, rates, plant, lastChange, canWrite }: {
  orgId: string; projectId: string; projectCode: string; orgName: string; rates: RateItem[];
  plant: Array<{ id: string; name: string; plant_no: string | null; active: boolean }>;
  lastChange: Record<string, { from: number | null; at: string }>; canWrite: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<CostKind>('labour');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const live = rates.filter((r) => r.active);
  const jobKeys = useMemo(() => new Set(live.filter((r) => r.project_id === projectId).map((r) => `${r.kind}|${norm(r.label)}`)), [live, projectId]);
  const ofKind = (k: CostKind) => live.filter((r) => r.kind === k)
    .sort((a, b) => a.label.localeCompare(b.label) || Number(a.project_id == null) - Number(b.project_id == null));
  const retired = rates.filter((r) => !r.active && r.kind === kind);
  const machine = (id: string | null) => plant.find((p) => p.id === id);

  function payload(d: Draft): Record<string, unknown> | string {
    const rate = Number(d.rate.replace(/[$,\s]/g, ''));
    if (!d.label.trim()) return 'Give the rate a name — the role, the machine or the material.';
    if (d.rate.trim() === '' || !Number.isFinite(rate) || rate < 0) return 'The rate is a number of dollars, 0 or more.';
    return { label: d.label, unit: d.unit, rate, plant_id: d.kind === 'plant' ? d.plant_id || null : null, notes: d.notes || null };
  }

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key); setError(null);
    try {
      const { error: err } = await fn();
      if (err) throw new Error(/duplicate key/i.test(err.message) ? 'There is already a live rate of that name on this card. Change that one, or retire it first.' : err.message);
      router.refresh();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); return false; }
    finally { setBusy(null); }
  }

  async function add() {
    if (!draft) return;
    const p = payload(draft);
    if (typeof p === 'string') { setError(p); return; }
    const ok = await run('new', () => createClient().from('rate_items').insert({ ...p, kind: draft.kind, org_id: orgId, project_id: draft.scope === 'job' ? projectId : null }));
    if (ok) setDraft(null);
  }
  async function save(id: string) {
    if (!edit) return;
    const p = payload(edit);
    if (typeof p === 'string') { setError(p); return; }
    const ok = await run(id, () => createClient().from('rate_items').update(p).eq('id', id));
    if (ok) { setEditing(null); setEdit(null); }
  }

  return (
    <div className="rates">
      <div className="templates__kinds" role="tablist" aria-label="Kind">
        {COST_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`review-tab${kind === k ? ' is-active' : ''}`} onClick={() => { setKind(k); setDraft(null); setEditing(null); setError(null); }}>
            {KIND_LABEL[k]} <span className="review-tab__count">{ofKind(k).length}</span>
          </button>
        ))}
      </div>
      {!canWrite && <p className="caption">Rates are set by the project manager or an admin. You can price variations from them.</p>}
      {error && <p className="alert">{error}</p>}

      {ofKind(kind).length === 0 ? (
        <p className="claims-nil">No {KIND_LABEL[kind].toLowerCase()} rates yet.{canWrite ? ' Add the first below.' : ''}</p>
      ) : (
        <ul className="plainlist rates__list">
          {ofKind(kind).map((r) => {
            const replaced = r.project_id == null && jobKeys.has(`${r.kind}|${norm(r.label)}`);
            const m = machine(r.plant_id);
            const change = lastChange[r.id];
            return (
              <li key={r.id} className={`rates__row${replaced ? ' rates__row--replaced' : ''}`}>
                {editing === r.id && edit ? (
                  <RateForm draft={edit} onChange={setEdit} plant={plant} canJob={false} projectCode={projectCode} orgName={orgName} busy={busy === r.id} onSave={() => void save(r.id)} onCancel={() => { setEditing(null); setEdit(null); }} saveLabel="Save" />
                ) : (
                  <>
                    <div className="rates__main">
                      <strong>{r.label}</strong>
                      <span className="caption">
                        {r.project_id ? `${projectCode} only` : 'Company'}
                        {m ? ` · ${m.name}${m.plant_no ? ` (${m.plant_no})` : ''}` : ''}
                        {replaced ? ` · replaced on ${projectCode} by its own rate` : ''}
                        {change ? ` · was ${fmtMoney(change.from)} until ${fmtPerthDate(change.at)}` : ''}
                      </span>
                      {r.notes && <span className="caption">{r.notes}</span>}
                    </div>
                    <span className="rates__rate mono">{fmtMoney(r.rate)}{per(r.unit)}</span>
                    {canWrite && (
                      <div className="rates__act">
                        <button type="button" className="quotebtn" disabled={busy != null} onClick={() => { setEditing(r.id); setEdit({ kind: r.kind, label: r.label, unit: r.unit, rate: String(r.rate), plant_id: r.plant_id ?? '', notes: r.notes ?? '', scope: r.project_id ? 'job' : 'company' }); setDraft(null); setError(null); }}>Edit</button>
                        <button type="button" className="quotebtn quotebtn--remove" disabled={busy != null} onClick={() => void run(r.id, () => createClient().from('rate_items').update({ active: false }).eq('id', r.id))}>Retire</button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (draft ? (
        <div className="item rates__add">
          <RateForm draft={draft} onChange={setDraft} plant={plant} canJob projectCode={projectCode} orgName={orgName} busy={busy === 'new'} onSave={() => void add()} onCancel={() => setDraft(null)} saveLabel="Add the rate" />
        </div>
      ) : (
        <button type="button" className="button" onClick={() => { setDraft(blank(kind)); setEditing(null); setError(null); }}>Add a {KIND_LABEL[kind].toLowerCase()} rate</button>
      ))}

      {retired.length > 0 && (
        <>
          <button type="button" className="linklike rates__retired-toggle" onClick={() => setShowRetired((v) => !v)}>{showRetired ? 'Hide' : 'Show'} {retired.length} retired</button>
          {showRetired && (
            <ul className="plainlist rates__list">
              {retired.map((r) => (
                <li key={r.id} className="rates__row rates__row--replaced">
                  <div className="rates__main"><strong>{r.label}</strong><span className="caption">{r.project_id ? `${projectCode} only` : 'Company'} · retired</span></div>
                  <span className="rates__rate mono">{fmtMoney(r.rate)}{per(r.unit)}</span>
                  {canWrite && <div className="rates__act"><button type="button" className="quotebtn" disabled={busy != null} onClick={() => void run(r.id, () => createClient().from('rate_items').update({ active: true }).eq('id', r.id))}>Restore</button></div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function RateForm({ draft, onChange, plant, canJob, projectCode, orgName, busy, onSave, onCancel, saveLabel }: {
  draft: Draft; onChange: (d: Draft) => void; plant: Array<{ id: string; name: string; plant_no: string | null; active: boolean }>;
  canJob: boolean; projectCode: string; orgName: string; busy: boolean; onSave: () => void; onCancel: () => void; saveLabel: string;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const units = UNITS.includes(draft.unit as (typeof UNITS)[number]) ? UNITS : [draft.unit, ...UNITS];
  return (
    <div className="bu-form">
      {draft.kind === 'plant' && (
        <label className="fieldcell"><span className="label">Machine (optional)</span>
          <select className="field field--sm" value={draft.plant_id} onChange={(e) => {
            const p = plant.find((x) => x.id === e.target.value);
            onChange({ ...draft, plant_id: e.target.value, label: draft.label || (p ? p.name : '') });
          }}>
            <option value="">Any machine of this kind</option>
            {plant.filter((p) => p.active || p.id === draft.plant_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.plant_no ? ` (${p.plant_no})` : ''}</option>)}
          </select></label>
      )}
      <label className="fieldcell"><span className="label">{draft.kind === 'labour' ? 'Role' : 'Name'}</span>
        <input className="field field--sm" value={draft.label} placeholder={EXAMPLE[draft.kind]} onChange={(e) => set('label', e.target.value)} /></label>
      <div className="bu-form__nums">
        <label className="fieldcell"><span className="label">Rate ($ ex GST)</span>
          <input className="field field--sm" inputMode="decimal" value={draft.rate} placeholder="95" onChange={(e) => set('rate', e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Per</span>
          <select className="field field--sm" value={draft.unit} onChange={(e) => set('unit', e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        {canJob && (
          <label className="fieldcell"><span className="label">Applies to</span>
            <select className="field field--sm" value={draft.scope} onChange={(e) => set('scope', e.target.value as Draft['scope'])}>
              <option value="company">Every job ({orgName})</option>
              <option value="job">{projectCode} only</option>
            </select></label>
        )}
      </div>
      <label className="fieldcell"><span className="label">Note (optional)</span>
        <input className="field field--sm" value={draft.notes} placeholder={draft.kind === 'labour' ? 'Ordinary time; overtime is its own rate' : 'Includes operator and fuel'} onChange={(e) => set('notes', e.target.value)} /></label>
      <div className="claims-actions">
        <button type="button" className="button" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
