'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  FOLDERS, KIND_HINT, KIND_LABEL, OWNERS, PRIORITIES, TEMPLATE_KINDS, TIERS, TIER_LABEL,
  countsByKind, folderName, itemProblems, orderItems, type Priority, type TemplateItem, type TemplateKind, type Tier,
} from '@/lib/templates/model';

export interface TemplateModule { key: string; name: string; description: string | null; sort: number; active: boolean }

type Draft = Omit<TemplateItem, 'id' | 'module_key' | 'sort' | 'active' | 'origin'>;
const blank = (kind: TemplateKind): Draft => ({
  kind, category: null, title: '', detail: null, priority: kind === 'start_gate' ? 'B' : null, min_tier: 'full',
  owner_role: kind === 'start_gate' || kind === 'submittal' ? 'office' : null, due_offset_days: null, unit: null, par_level: null, folder_no: null,
});

/**
 * The library editor (README R91). Pick a module, pick a kind, see what is
 * there, add or change or retire. Every save is one row under the office's
 * RLS; the database checks what the screen checks.
 */
export function TemplatesScreen({ orgId, projectId, modules, items, chosen }: { orgId: string; projectId: string; modules: TemplateModule[]; items: TemplateItem[]; chosen: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<TemplateKind>('start_gate');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const inModule = useMemo(() => items.filter((i) => i.module_key === chosen), [items, chosen]);
  const counts = useMemo(() => countsByKind(inModule), [inModule]);
  const total = useMemo(() => countsByKind(items), [items]);
  const list = orderItems(inModule.filter((i) => i.kind === kind && (showRetired || i.active)));
  const retiredCount = inModule.filter((i) => i.kind === kind && !i.active).length;

  async function save(row: Draft, id: string | null) {
    const problems = itemProblems(row);
    if (problems.length) { setError(`Still needs ${problems.join(', ')}.`); return; }
    setBusy(id ?? 'new'); setError(null);
    try {
      const supabase = createClient();
      const payload = { ...row, title: row.title.trim(), org_id: orgId, module_key: chosen };
      const { error: err } = id
        ? await supabase.from('template_items').update(payload).eq('id', id)
        : await supabase.from('template_items').insert(payload);
      if (err) throw new Error(err.message);
      setDraft(null); setEditing(null); setEdit(null);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }

  async function setActive(id: string, active: boolean) {
    setBusy(id); setError(null);
    try {
      const { error: err } = await createClient().from('template_items').update({ active }).eq('id', id);
      if (err) throw new Error(err.message);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="templates">
      <nav className="chips" aria-label="Module" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.75rem' }}>
        {modules.map((m) => {
          const n = items.filter((i) => i.module_key === m.key && i.active).length;
          return (
            <Link key={m.key} href={`/templates?project=${projectId}&module=${m.key}`} className={`chip chip--link${m.key === chosen ? ' chip--on' : ''}`} aria-current={m.key === chosen ? 'page' : undefined}>
              {m.name}{n ? ` · ${n}` : ''}
            </Link>
          );
        })}
      </nav>
      {modules.find((m) => m.key === chosen)?.description && <p className="caption">{modules.find((m) => m.key === chosen)?.description}</p>}

      <div className="templates__kinds" role="tablist">
        {TEMPLATE_KINDS.map((k) => (
          <button key={k} type="button" role="tab" className={`review-tab${kind === k ? ' is-active' : ''}`} onClick={() => { setKind(k); setDraft(null); setEditing(null); }}>
            {KIND_LABEL[k]} <span className="review-tab__count">{counts[k]}</span>
          </button>
        ))}
      </div>
      <p className="caption">{KIND_HINT[kind]}. Across every module: {total[kind]}.</p>

      {error && <p className="alert">{error}</p>}

      {!draft && (
        <button type="button" className="button button--quiet" onClick={() => { setDraft(blank(kind)); setEditing(null); setError(null); }}>
          Add {KIND_LABEL[kind].toLowerCase()}
        </button>
      )}
      {draft && <ItemForm value={draft} onChange={setDraft} onSave={() => void save(draft, null)} onCancel={() => setDraft(null)} busy={busy === 'new'} />}

      {list.length === 0 ? (
        <p className="claims-nil">Nothing in {KIND_LABEL[kind].toLowerCase()} for this module yet.</p>
      ) : (
        <ul className="plainlist templates__list">
          {list.map((it) => (
            <li key={it.id} className={`templates__row${it.active ? '' : ' templates__row--retired'}`}>
              {editing === it.id && edit ? (
                <ItemForm value={edit} onChange={setEdit} onSave={() => void save(edit, it.id)} onCancel={() => { setEditing(null); setEdit(null); }} busy={busy === it.id} />
              ) : (
                <>
                  <div className="templates__main">
                    <span className="templates__title">{it.title}</span>
                    <span className="templates__meta">
                      {it.category ? `${it.category} · ` : ''}
                      {it.priority ? `Priority ${it.priority} · ` : ''}
                      {it.min_tier === 'light' ? 'light and full · ' : 'full only · '}
                      {it.owner_role ? `${it.owner_role} · ` : ''}
                      {it.due_offset_days != null ? `due ${it.due_offset_days} day${it.due_offset_days === 1 ? '' : 's'} from start · ` : ''}
                      {it.par_level != null ? `par ${it.par_level} ${it.unit ?? ''} · ` : ''}
                      {it.folder_no != null ? `${folderName(it.folder_no)} · ` : ''}
                      {it.origin !== 'template' ? `from a job (${it.origin}) · ` : ''}
                      {it.active ? '' : 'retired'}
                    </span>
                    {it.detail && <span className="templates__detail">{it.detail}</span>}
                  </div>
                  <div className="templates__actions">
                    <button type="button" className="quotebtn" disabled={busy != null} onClick={() => { setEditing(it.id); setEdit({ kind: it.kind, category: it.category, title: it.title, detail: it.detail, priority: it.priority, min_tier: it.min_tier, owner_role: it.owner_role, due_offset_days: it.due_offset_days, unit: it.unit, par_level: it.par_level, folder_no: it.folder_no }); setDraft(null); }}>Edit</button>
                    {it.active
                      ? <button type="button" className="quotebtn quotebtn--remove" disabled={busy != null} onClick={() => void setActive(it.id, false)}>Retire</button>
                      : <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void setActive(it.id, true)}>Restore</button>}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {retiredCount > 0 && (
        <button type="button" className="linklike" onClick={() => setShowRetired((v) => !v)}>
          {showRetired ? 'Hide' : 'Show'} {retiredCount} retired
        </button>
      )}
    </div>
  );
}

function ItemForm({ value, onChange, onSave, onCancel, busy }: { value: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...value, [k]: v });
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <div className="item templates__form">
      <label className="fieldcell"><span className="label">Title</span>
        <input className="field field--sm" value={value.title} onChange={(e) => set('title', e.target.value)} placeholder={value.kind === 'consumable' ? 'Marking paint' : value.kind === 'document' ? 'Public liability certificate of currency' : 'Signed contract or LOI on file'} /></label>
      <label className="fieldcell"><span className="label">Detail (optional)</span>
        <textarea className="field field--sm" rows={2} value={value.detail ?? ''} onChange={(e) => set('detail', e.target.value || null)} placeholder="What good looks like, or where it comes from" /></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Category</span>
          <input className="field field--sm" value={value.category ?? ''} onChange={(e) => set('category', e.target.value || null)} placeholder={value.kind === 'consumable' ? '15 Site consumables' : 'Contract'} /></label>
        <label className="fieldcell"><span className="label">Tier</span>
          <select className="field field--sm" value={value.min_tier} onChange={(e) => set('min_tier', e.target.value as Tier)}>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</select></label>
      </div>
      {(value.kind === 'start_gate' || value.kind === 'submittal' || value.kind === 'hold_point' || value.kind === 'risk') && (
        <div className="signin__grid">
          <label className="fieldcell"><span className="label">Priority</span>
            <select className="field field--sm" value={value.priority ?? ''} onChange={(e) => set('priority', (e.target.value || null) as Priority | null)}><option value="">—</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label className="fieldcell"><span className="label">Owner</span>
            <select className="field field--sm" value={value.owner_role ?? ''} onChange={(e) => set('owner_role', (e.target.value || null) as Draft['owner_role'])}><option value="">—</option>{OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
          <label className="fieldcell"><span className="label">Due, days from start</span>
            <input className="field field--sm" type="number" value={value.due_offset_days ?? ''} onChange={(e) => set('due_offset_days', num(e.target.value))} /></label>
        </div>
      )}
      {value.kind === 'consumable' && (
        <div className="signin__grid">
          <label className="fieldcell"><span className="label">Par level</span>
            <input className="field field--sm" type="number" step="0.5" value={value.par_level ?? ''} onChange={(e) => set('par_level', num(e.target.value))} /></label>
          <label className="fieldcell"><span className="label">Unit</span>
            <input className="field field--sm" value={value.unit ?? ''} onChange={(e) => set('unit', e.target.value || null)} placeholder="cans, rolls, each" /></label>
        </div>
      )}
      {(value.kind === 'document' || value.kind === 'folder') && (
        <label className="fieldcell"><span className="label">Folder</span>
          <select className="field field--sm" value={value.folder_no ?? ''} onChange={(e) => set('folder_no', num(e.target.value))}><option value="">Pick the folder…</option>{FOLDERS.map((f) => <option key={f.no} value={f.no}>{folderName(f.no)}{f.office ? ' — office only' : ''}</option>)}</select></label>
      )}
      <div className="claims-actions">
        <button type="button" className="button" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
