'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BUILT_IN_TEMPLATES, INSPECTION_KINDS, KIND_LABEL, builtInItems, templateFromLines, type InspectionKind, type TemplateItem } from '@/lib/inspections/model';

interface Template { id: string; name: string; kind: InspectionKind; active: boolean; items: TemplateItem[] }
interface Props { orgId: string; userId: string; initial: Template[] }

export function TemplatesEditor({ orgId, userId, initial }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; name: string; kind: InspectionKind; lines: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(false); }
  }
  const save = () => run(async () => {
    if (!editing) return;
    const items = templateFromLines(editing.lines);
    if (!editing.name.trim()) throw new Error('Give it a name.');
    if (items.length === 0) throw new Error('At least one item.');
    const supabase = createClient();
    if (editing.id) {
      const { error: e } = await supabase.from('inspection_templates').update({ name: editing.name.trim(), kind: editing.kind, items }).eq('id', editing.id);
      if (e) throw new Error(e.message);
    } else {
      const { error: e } = await supabase.from('inspection_templates').insert({ org_id: orgId, name: editing.name.trim(), kind: editing.kind, items, created_by: userId });
      if (e) throw new Error(e.message);
    }
    setEditing(null);
  });
  const toggle = (t: Template) => run(async () => {
    const { error: e } = await createClient().from('inspection_templates').update({ active: !t.active }).eq('id', t.id);
    if (e) throw new Error(e.message);
  });
  const copyBuiltIn = (key: string) => {
    const b = BUILT_IN_TEMPLATES.find((x) => x.key === key);
    if (b) setEditing({ id: null, name: b.name, kind: b.kind, lines: builtInItems(b).map((i) => i.label).join('\n') });
  };

  return (
    <div className="templates">
      {initial.length === 0 && !editing && <p className="nil">No templates of your own yet — the standard ones are offered when an inspection starts.</p>}
      {initial.map((t) => (
        <div key={t.id} className={`prestart-row ${t.active ? '' : 'prestart-row--done'}`}>
          <span><strong>{t.name}</strong><br /><span className="caption">{KIND_LABEL[t.kind]} · {t.items.length} items{t.active ? '' : ' · retired'}</span></span>
          <span className="signin__actions">
            <button type="button" className="linklike" disabled={busy} onClick={() => setEditing({ id: t.id, name: t.name, kind: t.kind, lines: t.items.map((i) => i.label).join('\n') })}>Edit</button>
            <button type="button" className="linklike" disabled={busy} onClick={() => void toggle(t)}>{t.active ? 'Retire' : 'Bring back'}</button>
          </span>
        </div>
      ))}
      {!editing && (
        <div className="item">
          <p className="label">Add a template</p>
          <div className="crewchips">
            {BUILT_IN_TEMPLATES.map((b) => <button key={b.key} type="button" className="quotebtn crewchip" onClick={() => copyBuiltIn(b.key)}>Copy: {b.name}</button>)}
            <button type="button" className="quotebtn crewchip" onClick={() => setEditing({ id: null, name: '', kind: 'site', lines: '' })}>Blank</button>
          </div>
        </div>
      )}
      {editing && (
        <div className="item">
          <label className="fieldcell"><span className="label">Name</span><input className="field field--sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label className="fieldcell fieldcell--narrow"><span className="label">Kind</span>
            <select className="field field--sm" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as InspectionKind })}>
              {INSPECTION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select></label>
          <label className="fieldcell"><span className="label">Items, one per line</span>
            <textarea className="field field--sm" rows={12} value={editing.lines} onChange={(e) => setEditing({ ...editing, lines: e.target.value })} /></label>
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="photo-add-pair">
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && !editing && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
