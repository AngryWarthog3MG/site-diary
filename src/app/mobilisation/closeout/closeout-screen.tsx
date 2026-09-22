'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { KIND_LABEL, OWNERS, PRIORITIES, TIERS, TIER_LABEL, type Priority, type Tier } from '@/lib/templates/model';
import { orderSetup, type SetupItem } from '@/lib/setup/model';
import { jobSpecifics, suggestGeneric, undecided, type JobNames } from '@/lib/setup/closeout';
import type { TemplateModule } from '@/app/templates/templates-screen';

interface Draft { module: string; title: string; category: string; detail: string; min_tier: Tier; priority: Priority | null; owner_role: 'office' | 'site' | null }

/**
 * One decision per item. The form opens prefilled with a generic rewording
 * (the head contractor and the job replaced); the office reads it, fixes it,
 * picks the module and tier. The DB refuses a title that still names either.
 */
export function CloseoutScreen({ projectId, names, modules, items }: { projectId: string; names: JobNames; modules: TemplateModule[]; items: SetupItem[] }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const toDecide = useMemo(() => undecided(items), [items]);
  const list = orderSetup(showAll ? items : toDecide);
  const moduleName = (key: string | null) => modules.find((m) => m.key === key)?.name ?? key ?? '';
  const warn = draft ? jobSpecifics(`${draft.title} ${draft.detail}`, names) : [];

  const begin = (it: SetupItem) => {
    setOpen(it.id);
    setDraft({
      module: it.module_key && modules.some((m) => m.key === it.module_key) ? it.module_key : 'core',
      title: suggestGeneric(it.title, names), category: it.category ?? '', detail: '',
      min_tier: 'full', priority: it.priority, owner_role: it.owner_role,
    });
    setError(null); setNote(null);
  };

  async function call(label: string, fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, done: (data: unknown) => void) {
    setBusy(label); setError(null); setNote(null);
    try {
      const { error: err, data } = await fn();
      if (err) throw new Error(err.message);
      done(data);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }
  const promote = (it: SetupItem, d: Draft) => call(it.id, () => createClient().rpc('promote_setup_item', {
    p_item: it.id, p_module: d.module, p_title: d.title, p_category: d.category || null, p_detail: d.detail || null,
    p_min_tier: d.min_tier, p_priority: d.priority, p_owner_role: d.owner_role,
  }), () => { setNote(`Promoted to ${moduleName(d.module)}: “${d.title.trim()}”.`); setOpen(null); setDraft(null); });
  const leave = (it: SetupItem) => call(it.id, () => createClient().rpc('leave_setup_item', { p_item: it.id }), () => { setNote(`Left as a one-off: “${it.title}”.`); if (open === it.id) { setOpen(null); setDraft(null); } });

  return (
    <div className="setup">
      <div className="setup__progress">
        <div className="setup__stat"><span className={`setup__big mono${toDecide.length > 0 ? '' : ' setup__big--ok'}`}>{toDecide.length}</span><span className="caption">to decide</span></div>
        <div className="setup__stat"><span className="setup__big mono">{items.filter((i) => i.promotion_decision === 'promoted').length}</span><span className="caption">promoted</span></div>
        <div className="setup__stat"><span className="setup__big mono">{items.filter((i) => i.promotion_decision === 'one_off').length}</span><span className="caption">one-offs</span></div>
      </div>
      <div className="setup__filters">
        <label className="setup__filter"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show decided items too</label>
      </div>
      {error && <p className="alert">{error}</p>}
      {note && <p className="caption setup__note">{note}</p>}

      {list.length === 0 ? (
        <p className="claims-nil">{items.length === 0 ? 'This job added nothing of its own — everything on the board came from the templates.' : 'Every one of this job’s own items has been decided.'}</p>
      ) : (
        <ul className="plainlist templates__list">
          {list.map((it) => (
            <li key={it.id} className={`templates__row${it.promotion_decision ? ' setup__row--done' : ''}`}>
              <div className="templates__main">
                <span className="templates__title">{it.title}</span>
                <span className="templates__meta">
                  {KIND_LABEL[it.kind]} · {it.origin === 'manual' ? 'added by hand' : 'from the contract'}
                  {it.category ? ` · ${it.category}` : ''}{it.priority ? ` · priority ${it.priority}` : ''}
                  {it.promotion_decision === 'promoted' ? ` · promoted${it.decided_at ? '' : ''}` : it.promotion_decision === 'one_off' ? ' · left as a one-off' : ''}
                </span>
                {it.detail && <span className="templates__detail">{it.detail}</span>}
                {open === it.id && draft && (
                  <div className="item templates__form">
                    <label className="fieldcell"><span className="label">As the template will read it — no client, no site</span>
                      <input className="field field--sm" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                    <label className="fieldcell"><span className="label">Detail for the template (optional — the contract quote stays on this job)</span>
                      <textarea className="field field--sm" rows={2} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} placeholder="What good looks like, in general terms" /></label>
                    {warn.length > 0 && <p className="alert">Still names {warn.map((w) => `“${w}”`).join(' and ')} — the library will refuse it.</p>}
                    <div className="signin__grid">
                      <label className="fieldcell"><span className="label">Module</span>
                        <select className="field field--sm" value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>{modules.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
                      <label className="fieldcell"><span className="label">Tier</span>
                        <select className="field field--sm" value={draft.min_tier} onChange={(e) => setDraft({ ...draft, min_tier: e.target.value as Tier })}>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</select></label>
                      <label className="fieldcell"><span className="label">Category</span>
                        <input className="field field--sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
                      <label className="fieldcell"><span className="label">Priority</span>
                        <select className="field field--sm" value={draft.priority ?? ''} onChange={(e) => setDraft({ ...draft, priority: (e.target.value || null) as Priority | null })}><option value="">—</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                      <label className="fieldcell"><span className="label">Owner</span>
                        <select className="field field--sm" value={draft.owner_role ?? ''} onChange={(e) => setDraft({ ...draft, owner_role: (e.target.value || null) as Draft['owner_role'] })}><option value="">—</option>{OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
                    </div>
                    <div className="claims-actions">
                      <button type="button" className="button" disabled={busy != null || warn.length > 0 || !draft.title.trim()} onClick={() => void promote(it, draft)}>{busy === it.id ? 'Promoting…' : `Promote to ${moduleName(draft.module)}`}</button>
                      <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => { setOpen(null); setDraft(null); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="templates__actions">
                {it.promotion_decision !== 'promoted' && open !== it.id && (
                  <button type="button" className="quotebtn" disabled={busy != null} onClick={() => begin(it)}>Promote…</button>
                )}
                {it.promotion_decision == null && (
                  <button type="button" className="quotebtn" disabled={busy != null} onClick={() => void leave(it)}>Leave as one-off</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
