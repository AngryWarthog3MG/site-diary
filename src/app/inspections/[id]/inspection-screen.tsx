'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { KIND_LABEL, RESULT_LABEL, findings, answered, actionOverdue, type InspectionItem, type InspectionKind } from '@/lib/inspections/model';

export interface InspectionView {
  id: string; projectId: string; template_name: string; kind: InspectionKind; inspection_date: string; area: string | null; inspector_name: string;
  items: InspectionItem[]; summary: string | null; signature_path: string | null; completed_at: string | null; completed_on_device_at: string | null;
  actions: Array<{ id: string; item_key: string | null; action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null; created_by: string }>;
}
interface Props { inspection: InspectionView; crew: string[]; canManage: boolean; userId: string; today: string }

export function InspectionScreen({ inspection: r, crew, canManage, userId, today }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string | null; action: string; owner: string; due: string } | null>(null);
  const [doneNote, setDoneNote] = useState<Record<string, string>>({});
  const issues = findings(r.items);
  const done = Boolean(r.completed_at);

  useEffect(() => {
    const paths = [...r.items.flatMap((i) => i.photo_urls), ...(r.signature_path ? [r.signature_path] : [])];
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('entry-photos').createSignedUrls(paths, 3600);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [r.items, r.signature_path]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const addAction = () => run('add the action', async () => {
    if (!draft || !draft.action.trim()) throw new Error('Say what has to be done.');
    const { error: e } = await createClient().from('inspection_actions').insert({ inspection_id: r.id, item_key: draft.key, action: draft.action.trim(), owner_name: draft.owner.trim() || null, due_on: draft.due || null, created_by: userId });
    if (e) throw new Error(e.message);
    setDraft(null);
  });
  const markDone = (id: string) => run('mark it done', async () => {
    const { data, error: e } = await createClient().from('inspection_actions').update({ done_at: new Date().toISOString(), done_note: (doneNote[id] ?? '').trim() || null }).eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const removeAction = (id: string) => run('remove the action', async () => {
    const { data, error: e } = await createClient().from('inspection_actions').delete().eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account, or already done.');
  });
  const pdf = () => run('make the PDF', async () => {
    const res = await fetch(`/api/inspections/${r.id}/pdf`, { method: 'POST' });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The PDF could not be made.');
    window.open(body.url, '_blank', 'noopener');
  });

  const actionRow = (a: InspectionView['actions'][number]) => {
    const late = actionOverdue(a, today);
    return (
      <div key={a.id} className={`incident__action${a.done_at ? ' incident__action--done' : late ? ' incident__action--late' : ''}`}>
        <div>
          <p className="incident__text">{a.action}</p>
          <p className="caption">{a.owner_name ?? 'no owner'}{a.due_on ? ` · due ${fmtDate(a.due_on)}` : ''}{late ? ' · OVERDUE' : ''}{a.done_at ? ` · done ${fmtDate(a.done_at.slice(0, 10))}${a.done_note ? ` — ${a.done_note}` : ''}` : ''}</p>
        </div>
        {!a.done_at && canManage && (
          <div className="signin__actions">
            <input className="field field--sm" placeholder="How it was done" value={doneNote[a.id] ?? ''} onChange={(e) => setDoneNote({ ...doneNote, [a.id]: e.target.value })} />
            <button type="button" className="button button--quiet signin__out" disabled={busy != null} onClick={() => void markDone(a.id)}>Done</button>
            {a.created_by === userId && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void removeAction(a.id)}>Remove</button>}
          </div>
        )}
      </div>
    );
  };
  const addForm = (key: string | null) => draft && draft.key === key && (
    <div className="incident__add">
      <label className="fieldcell"><span className="label">Action</span>
        <input className="field field--sm" value={draft.action} placeholder="What has to happen" onChange={(e) => setDraft({ ...draft, action: e.target.value })} /></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Owner</span><input className="field field--sm" value={draft.owner} list="inspection-owners" onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></label>
        <label className="fieldcell fieldcell--narrow"><span className="label">Due</span><input className="field field--sm" type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} /></label>
      </div>
      <div className="photo-add-pair">
        <button type="button" className="button button--quiet" style={{ marginTop: 0 }} disabled={busy != null || !draft.action.trim()} onClick={() => void addAction()}>Add the action</button>
        <button type="button" className="button button--quiet" style={{ marginTop: 0 }} onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <section className="inspection">
      <p className="label">{KIND_LABEL[r.kind]} · {fmtDate(r.inspection_date)}{r.area ? ` · ${r.area}` : ''}</p>
      <h1 className="page-title">{r.template_name}</h1>
      <p className={`page-subtitle ${done ? '' : 'vr-missing'}`}>
        {done ? `Signed by ${r.inspector_name} · ${finishedAtAwst(r.completed_at as string, r.completed_on_device_at)}` : 'Not signed — nothing here is on the record yet'}
        {done ? ` · ${answered(r.items)} of ${r.items.length} checked · ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}
      </p>
      <datalist id="inspection-owners">{crew.map((c) => <option key={c} value={c} />)}</datalist>

      <ul className="tri-list">
        {r.items.map((i) => {
          const itemActions = r.actions.filter((a) => a.item_key === i.key);
          return (
            <li key={i.key} className={`tri${i.result === 'ok' ? ' tri--ok' : i.result === 'issue' ? ' tri--defect' : i.result === 'na' ? ' tri--na' : ''}`}>
              <p className="tri__label">{i.label} <span className="mono caption">{i.result ? RESULT_LABEL[i.result] : 'not checked'}</span></p>
              {i.note && <p className="incident__text">{i.note}</p>}
              {i.photo_urls.length > 0 && (
                <div className="photos__grid report-form__photos">
                  {i.photo_urls.map((p) => (
                    <figure key={p}>{urls[p] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <a href={urls[p]} target="_blank" rel="noopener"><img src={urls[p]} alt="" /></a>
                    ) : <span className="talk-attendee__pending" />}</figure>
                  ))}
                </div>
              )}
              {itemActions.map(actionRow)}
              {i.result === 'issue' && canManage && done && !draft && (
                <button type="button" className="linklike" onClick={() => setDraft({ key: i.key, action: '', owner: '', due: '' })}>Add a corrective action</button>
              )}
              {addForm(i.key)}
            </li>
          );
        })}
      </ul>
      {r.summary && <div className="item"><p className="label">Overall</p><p className="incident__text">{r.summary}</p></div>}

      <div className="item">
        <p className="label">Other actions</p>
        {r.actions.filter((a) => !a.item_key).length === 0 && <p className="nil">None.</p>}
        {r.actions.filter((a) => !a.item_key).map(actionRow)}
        {canManage && done && !draft && <button type="button" className="linklike" onClick={() => setDraft({ key: null, action: '', owner: '', due: '' })}>Add an action</button>}
        {addForm(null)}
      </div>

      {r.signature_path && urls[r.signature_path] && (
        <div className="talk-attendee">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[r.signature_path]} alt="" /><span>{r.inspector_name}</span>
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
      {done && <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void pdf()}>{busy === 'make the PDF' ? 'Making the PDF…' : 'Inspection PDF'}</button>}
    </section>
  );
}
