'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  FOLDERS, KIND_LABEL, OWNERS, PRIORITIES, TEMPLATE_KINDS, TIERS, TIER_LABEL, folderName,
  type Priority, type TemplateKind, type Tier,
} from '@/lib/templates/model';
import { STATUS_LABEL, isOverdue, orderSetup, summarise, type SetupItem, type SetupStatus } from '@/lib/setup/model';
import { undecided } from '@/lib/setup/closeout';
import type { TemplateModule } from '@/app/templates/templates-screen';

interface Props {
  projectId: string;
  tier: Tier;
  startOn: string | null;
  attached: string[];
  modules: TemplateModule[];
  items: SetupItem[];
  libraryItems: number;
  today: string;
}

type Edit = Pick<SetupItem, 'owner_name' | 'due_on' | 'evidence' | 'detail' | 'status_note'>;
interface Manual { kind: TemplateKind; title: string; category: string; priority: Priority | null; owner_role: 'office' | 'site' | null; owner_name: string; due_on: string; folder_no: number | null; unit: string; par_level: number | null }

const fmt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

/**
 * The board. Set up once from the templates (tier and modules), then work
 * it: done, not applicable, reopen; owner, due date and evidence by hand;
 * items of the job's own added by hand. Every write is one row under the
 * office's RLS; the DB stamps who finished what and when.
 */
export function MobilisationScreen({ projectId, tier, startOn, attached, modules, items, libraryItems, today }: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<TemplateKind>('start_gate');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [priority, setPriority] = useState<'' | Priority>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickTier, setPickTier] = useState<Tier>(tier);
  const [pickMods, setPickMods] = useState<string[]>(attached.filter((m) => m !== 'core'));
  const [addMod, setAddMod] = useState('');
  const [start, setStart] = useState(startOn ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [naFor, setNaFor] = useState<string | null>(null);
  const [naNote, setNaNote] = useState('');
  const [manual, setManual] = useState<Manual | null>(null);

  const setUp = attached.length > 0;
  const summary = useMemo(() => summarise(items, today), [items, today]);
  const ofKind = items.filter((i) => i.kind === kind);
  const list = orderSetup(ofKind.filter((i) => (!onlyOpen || i.status === 'open') && (!priority || i.priority === priority)));
  const unattached = modules.filter((m) => !attached.includes(m.key));
  const toDecide = undecided(items).length;
  const ownItems = items.filter((i) => i.origin !== 'template').length;
  const moduleName = (key: string) => modules.find((m) => m.key === key)?.name ?? key;

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, done?: (data: unknown) => void) {
    setBusy(label); setError(null); setNote(null);
    try {
      const { error: err, data } = await fn();
      if (err) throw new Error(err.message);
      done?.(data);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }
  const stamp = (mods: string[], t: Tier | null) => run('stamp', () => createClient().rpc('instantiate_project', { p_project: projectId, p_modules: mods, p_tier: t }), (data) => {
    const r = data as { added: number; by_kind: Record<string, number> } | null;
    const parts = r ? Object.entries(r.by_kind).map(([k, n]) => `${n} ${KIND_LABEL[k as TemplateKind].toLowerCase()}`) : [];
    setNote(r && r.added > 0 ? `Added ${r.added}: ${parts.join(', ')}.` : 'Nothing to add — the board already has everything the templates hold.');
    setAddMod('');
  });
  const setStatus = (id: string, status: SetupStatus, status_note?: string) =>
    run(id, () => createClient().from('project_setup_items').update(status_note === undefined ? { status } : { status, status_note }).eq('id', id), () => { setNaFor(null); setNaNote(''); });
  const saveEdit = (id: string, e: Edit) =>
    run(id, () => createClient().from('project_setup_items').update({ ...e, due_on: e.due_on || null }).eq('id', id), () => { setEditing(null); setEdit(null); });
  const saveStart = () => run('start', () => createClient().rpc('set_project_start', { p_project: projectId, p_start_on: start || null }));
  const addManual = (m: Manual) => {
    if (!m.title.trim()) { setError('The item needs a title.'); return; }
    if ((m.kind === 'document' || m.kind === 'folder') && m.folder_no == null) { setError('A document or folder names its folder.'); return; }
    void run('manual', () => createClient().from('project_setup_items').insert({
      project_id: projectId, kind: m.kind, title: m.title.trim(), category: m.category || null, priority: m.priority, owner_role: m.owner_role,
      owner_name: m.owner_name || null, due_on: m.due_on || null, folder_no: m.folder_no, unit: m.unit || null, par_level: m.par_level, origin: 'manual',
    }), () => setManual(null));
  };

  return (
    <div className="setup">
      {!setUp ? (
        <section className="item setup__picker">
          <p className="label">Set this job up from the templates</p>
          {libraryItems === 0 && (
            <p className="alert">The company&rsquo;s library is empty, so there is nothing to stamp yet. <Link href={`/templates?project=${projectId}`}>Fill the templates</Link> first — Core at the light tier is the ten things every job needs.</p>
          )}
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Tier</span>
              <select className="field field--sm" value={pickTier} onChange={(e) => setPickTier(e.target.value as Tier)}>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</select></label>
          </div>
          <p className="label">Modules</p>
          <div className="setup__mods">
            {modules.map((m) => (
              <label key={m.key} className="setup__mod">
                <input type="checkbox" checked={m.key === 'core' || pickMods.includes(m.key)} disabled={m.key === 'core'} onChange={(e) => setPickMods((prev) => (e.target.checked ? [...prev, m.key] : prev.filter((k) => k !== m.key)))} />
                <span><strong>{m.name}</strong>{m.key === 'core' ? ' — every job' : m.description ? ` — ${m.description}` : ''}</span>
              </label>
            ))}
          </div>
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy != null || libraryItems === 0} onClick={() => void stamp(pickMods, pickTier)}>{busy === 'stamp' ? 'Stamping…' : 'Set up from templates'}</button>
          </div>
        </section>
      ) : (
        <section className="setup__head">
          <p className="caption">
            <strong>{tier === 'light' ? 'Light tier' : 'Full tier'}</strong> · modules: {attached.map(moduleName).join(', ')}
            {startOn ? ` · starts ${fmt(startOn)}` : ' · no start date yet'}
          </p>
          <div className="setup__tools">
            <label className="fieldcell"><span className="label">Start date (due dates count from it)</span>
              <span className="setup__inline"><input className="field field--sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                <button type="button" className="quotebtn" disabled={busy != null || start === (startOn ?? '')} onClick={() => void saveStart()}>Save</button></span></label>
            {unattached.length > 0 && (
              <label className="fieldcell"><span className="label">Add a module</span>
                <span className="setup__inline"><select className="field field--sm" value={addMod} onChange={(e) => setAddMod(e.target.value)}><option value="">Pick one…</option>{unattached.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
                  <button type="button" className="quotebtn" disabled={busy != null || !addMod} onClick={() => void stamp([addMod], null)}>Attach</button></span></label>
            )}
            {ownItems > 0 && (
              <label className="fieldcell"><span className="label">Closeout</span>
                <span className="setup__inline">
                  <Link className="quotebtn" href={`/mobilisation/closeout?project=${projectId}`}>{toDecide > 0 ? `Review ${toDecide} of this job’s own items for the templates` : 'Closeout review — all decided'}</Link>
                </span></label>
            )}
            <label className="fieldcell"><span className="label">The library grew?</span>
              <span className="setup__inline">
                <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void stamp([], null)}>Re-stamp: add what is missing</button>
                {tier === 'light' && <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void stamp([], 'full')}>Raise to full tier</button>}
              </span></label>
          </div>
          <div className="setup__progress">
            <div className="setup__stat"><span className="setup__big mono">{summary.startGate.percent == null ? '—' : `${summary.startGate.percent}%`}</span><span className="caption">mobilisation done</span></div>
            <div className="setup__stat"><span className={`setup__big mono${summary.priorityAOpen > 0 ? ' setup__big--bad' : ''}`}>{summary.priorityAOpen}</span><span className="caption">priority A open</span></div>
            <div className="setup__stat"><span className={`setup__big mono${summary.overdue > 0 ? ' setup__big--bad' : ''}`}>{summary.overdue}</span><span className="caption">overdue</span></div>
            <div className="setup__stat"><span className={`setup__big mono${summary.documentGaps > 0 ? ' setup__big--bad' : ''}`}>{summary.documentGaps}</span><span className="caption">document gaps</span></div>
          </div>
          {summary.startGate.byCategory.length > 0 && (
            <ul className="plainlist setup__cats">
              {summary.startGate.byCategory.map((c) => (
                <li key={c.category} className="setup__cat">
                  <span className="setup__cat-name">{c.category}</span>
                  <span className="setup__bar" aria-hidden><span className="setup__bar-fill" style={{ width: `${c.percent}%` }} /></span>
                  <span className="mono caption">{c.done}/{c.total}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <p className="alert">{error}</p>}
      {note && <p className="caption setup__note">{note}</p>}

      <div className="templates__kinds" role="tablist">
        {TEMPLATE_KINDS.map((k) => {
          const c = summary.byKind[k];
          return (
            <button key={k} type="button" role="tab" className={`review-tab${kind === k ? ' is-active' : ''}`} onClick={() => { setKind(k); setManual(null); setEditing(null); }}>
              {KIND_LABEL[k]} <span className="review-tab__count">{c.open}/{c.open + c.done + c.not_applicable}</span>
            </button>
          );
        })}
      </div>
      <div className="setup__filters">
        <label className="setup__filter"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Open only</label>
        <label className="setup__filter">Priority <select className="field field--sm" value={priority} onChange={(e) => setPriority(e.target.value as '' | Priority)}><option value="">any</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        {!manual && <button type="button" className="linklike" onClick={() => setManual({ kind, title: '', category: '', priority: kind === 'start_gate' ? 'B' : null, owner_role: null, owner_name: '', due_on: '', folder_no: null, unit: '', par_level: null })}>Add {KIND_LABEL[kind].toLowerCase()} by hand</button>}
      </div>

      {manual && (
        <div className="item templates__form">
          <label className="fieldcell"><span className="label">Title</span><input className="field field--sm" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></label>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Category</span><input className="field field--sm" value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Priority</span><select className="field field--sm" value={manual.priority ?? ''} onChange={(e) => setManual({ ...manual, priority: (e.target.value || null) as Priority | null })}><option value="">—</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label className="fieldcell"><span className="label">Owner</span><select className="field field--sm" value={manual.owner_role ?? ''} onChange={(e) => setManual({ ...manual, owner_role: (e.target.value || null) as Manual['owner_role'] })}><option value="">—</option>{OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
            <label className="fieldcell"><span className="label">Who</span><input className="field field--sm" value={manual.owner_name} onChange={(e) => setManual({ ...manual, owner_name: e.target.value })} placeholder="A name" /></label>
            <label className="fieldcell"><span className="label">Due</span><input className="field field--sm" type="date" value={manual.due_on} onChange={(e) => setManual({ ...manual, due_on: e.target.value })} /></label>
            {(manual.kind === 'document' || manual.kind === 'folder') && (
              <label className="fieldcell"><span className="label">Folder</span><select className="field field--sm" value={manual.folder_no ?? ''} onChange={(e) => setManual({ ...manual, folder_no: e.target.value ? Number(e.target.value) : null })}><option value="">Pick…</option>{FOLDERS.map((f) => <option key={f.no} value={f.no}>{folderName(f.no)}</option>)}</select></label>
            )}
            {manual.kind === 'consumable' && (<>
              <label className="fieldcell"><span className="label">Par level</span><input className="field field--sm" type="number" step="0.5" value={manual.par_level ?? ''} onChange={(e) => setManual({ ...manual, par_level: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label className="fieldcell"><span className="label">Unit</span><input className="field field--sm" value={manual.unit} onChange={(e) => setManual({ ...manual, unit: e.target.value })} /></label>
            </>)}
          </div>
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy != null} onClick={() => addManual(manual)}>{busy === 'manual' ? 'Saving…' : 'Add to the board'}</button>
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => setManual(null)}>Cancel</button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <p className="claims-nil">{ofKind.length === 0 ? `Nothing in ${KIND_LABEL[kind].toLowerCase()} on this job.` : `Nothing ${onlyOpen ? 'open' : 'matching'} in ${KIND_LABEL[kind].toLowerCase()}.`}</p>
      ) : (
        <ul className="plainlist templates__list">
          {list.map((it) => {
            const late = isOverdue(it, today);
            return (
              <li key={it.id} className={`templates__row setup__row--${it.status}`}>
                <div className="templates__main">
                  <span className="templates__title">{it.title}{it.priority === 'A' && it.status === 'open' ? <span className="setup__a"> A</span> : null}</span>
                  <span className="templates__meta">
                    {it.category ? `${it.category} · ` : ''}
                    {it.priority && it.priority !== 'A' ? `Priority ${it.priority} · ` : ''}
                    {it.owner_name ? `${it.owner_name} · ` : it.owner_role ? `${it.owner_role} · ` : ''}
                    {it.due_on ? <span className={late ? 'setup__late' : undefined}>{late ? 'overdue ' : 'due '}{fmt(it.due_on)} · </span> : ''}
                    {it.par_level != null ? `par ${it.par_level} ${it.unit ?? ''} · ` : ''}
                    {it.folder_no != null ? `${folderName(it.folder_no)} · ` : ''}
                    {it.origin !== 'template' ? `${it.origin === 'manual' ? 'added by hand' : 'from the contract'} · ` : it.module_key && it.module_key !== 'core' ? `${moduleName(it.module_key)} · ` : ''}
                    {it.status !== 'open' ? `${STATUS_LABEL[it.status]}${it.status_note ? `: ${it.status_note}` : ''}` : ''}
                  </span>
                  {it.detail && <span className="templates__detail">{it.detail}</span>}
                  {it.evidence && <span className="templates__detail">Evidence: {it.evidence}</span>}
                  {editing === it.id && edit && (
                    <div className="item templates__form">
                      <div className="signin__grid">
                        <label className="fieldcell"><span className="label">Who</span><input className="field field--sm" value={edit.owner_name ?? ''} onChange={(e) => setEdit({ ...edit, owner_name: e.target.value || null })} /></label>
                        <label className="fieldcell"><span className="label">Due</span><input className="field field--sm" type="date" value={edit.due_on ?? ''} onChange={(e) => setEdit({ ...edit, due_on: e.target.value || null })} /></label>
                      </div>
                      <label className="fieldcell"><span className="label">Evidence (where it is — a link, a folder, a reference)</span><input className="field field--sm" value={edit.evidence ?? ''} onChange={(e) => setEdit({ ...edit, evidence: e.target.value || null })} /></label>
                      <label className="fieldcell"><span className="label">Detail</span><textarea className="field field--sm" rows={2} value={edit.detail ?? ''} onChange={(e) => setEdit({ ...edit, detail: e.target.value || null })} /></label>
                      <div className="claims-actions">
                        <button type="button" className="button" disabled={busy != null} onClick={() => void saveEdit(it.id, edit)}>{busy === it.id ? 'Saving…' : 'Save'}</button>
                        <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => { setEditing(null); setEdit(null); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {naFor === it.id && (
                    <div className="item templates__form">
                      <label className="fieldcell"><span className="label">Why it does not apply</span><input className="field field--sm" value={naNote} onChange={(e) => setNaNote(e.target.value)} placeholder="No camp: the crew day-trips" /></label>
                      <div className="claims-actions">
                        <button type="button" className="button" disabled={busy != null || !naNote.trim()} onClick={() => void setStatus(it.id, 'not_applicable', naNote)}>Mark not applicable</button>
                        <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => { setNaFor(null); setNaNote(''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="templates__actions">
                  {it.status === 'open' ? (<>
                    <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void setStatus(it.id, 'done')}>Done</button>
                    <button type="button" className="quotebtn" disabled={busy != null} onClick={() => { setNaFor(it.id); setNaNote(''); setEditing(null); }}>N/A</button>
                  </>) : (
                    <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void setStatus(it.id, 'open', '')}>Reopen</button>
                  )}
                  <button type="button" className="quotebtn" disabled={busy != null} onClick={() => { setEditing(it.id); setEdit({ owner_name: it.owner_name, due_on: it.due_on, evidence: it.evidence, detail: it.detail, status_note: it.status_note }); setNaFor(null); }}>Edit</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
