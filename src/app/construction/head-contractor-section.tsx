'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate } from '@/lib/pdf/dates';
import { currentDocs, headContractorName, HC_DOC_KINDS, HC_DOC_LABEL, HC_DOC_EXPECTED, type HcDoc, type HcDocKind } from '@/lib/subcontract/model';

/**
 * The head contractor on this job (README R74): who they are, how soon they want to hear of
 * an incident, and the copies of their plans the crew works to — each copy kept, a newer
 * revision superseding the old one rather than replacing it.
 */
export function HeadContractorSection({ projectId, contractor, hours, docs, today, canManage, isAdmin }: {
  projectId: string; contractor: string | null; hours: number | null; docs: HcDoc[]; today: string; canManage: boolean; isAdmin: boolean;
}) {
  const router = useRouter();
  const name = headContractorName(contractor);
  const pendingDocs = usePending('hc_document', projectId, 'project').map((q) => q.payload.row as HcDoc);
  const current = currentDocs(docs);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoursText, setHoursText] = useState(hours?.toString() ?? '');
  // "Replaces" is chosen, never assumed from the kind: two traffic plans can both be in force, and an "other" is rarely a new revision of another "other" (README R78).
  const [form, setForm] = useState<{ open: boolean; kind: HcDocKind; title: string; revision: string; on: string; notes: string; replaces: string }>({ open: false, kind: 'whs_management_plan', title: '', revision: '', on: today, notes: '', replaces: '' });
  const [file, setFile] = useState<File | null>(null);
  const [showOld, setShowOld] = useState(false);

  useEffect(() => {
    const paths = docs.map((d) => d.file_path).filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    let cancelled = false;
    void createClient().storage.from('head-contractor-docs').createSignedUrls(paths, 600).then(({ data }) => {
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const r of data) if (r.path && r.signedUrl) next[r.path] = r.signedUrl;
      setUrls(next);
    });
    return () => { cancelled = true; };
  }, [docs]);

  async function act(key: string, fn: () => Promise<'queued' | void>) {
    setBusy(key); setError(null);
    // Refreshed only when it reached the server: a queued save shows from the phone, and a refresh on weak signal blanks the page (README R78).
    try { const outcome = await fn(); if (outcome !== 'queued') router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }

  const older = docs.filter((d) => d.superseded_by).sort((a, b) => b.received_on.localeCompare(a.received_on));
  const line = (d: HcDoc) => (
    <>
      <strong>{d.title}</strong>{d.revision ? ` · ${d.revision}` : ''} · received {fmtDate(d.received_on)}
      {d.file_path ? (urls[d.file_path] ? <> · <a href={urls[d.file_path]} target="_blank" rel="noopener">open</a></> : ' · file kept') : ' · sighted, no copy kept'}
      {d.notes ? <><br /><span className="caption">{d.notes}</span></> : null}
    </>
  );

  return (
    <section style={{ marginTop: '1rem' }}>
      <hr className="rule" />
      <p className="label">Head contractor — {name}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {!contractor && <p className="caption vr-missing">No head contractor named for this job. An admin adds it in Settings.</p>}

      <div className="signin__grid" style={{ alignItems: 'end' }}>
        <label className="fieldcell fieldcell--narrow"><span className="label">Tell them of an incident within (hours)</span>
          <input id="hc-hours" className="field field--sm" inputMode="numeric" disabled={!isAdmin} placeholder="Their site rules" value={hoursText} onChange={(e) => setHoursText(e.target.value)} /></label>
        {isAdmin && (
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('hours', async () => {
            const n = hoursText.trim() === '' ? null : Number(hoursText);
            if (n != null && !(Number.isInteger(n) && n >= 1 && n <= 168)) throw new Error('Whole hours from 1 to 168, or blank for none.');
            const { error: e } = await createClient().from('projects').update({ head_contractor_incident_hours: n }).eq('id', projectId);
            if (e) throw new Error(e.message);
          })}>Save</button>
        )}
      </div>
      <p className="caption">From their site rules or the subcontract. Blank means no deadline is tracked; every report still shows whether they were told.</p>

      <p className="label" style={{ marginTop: '0.75rem' }}>Their plans we work to</p>
      {pendingDocs.length > 0 && (
        <ul className="gaplist">
          {pendingDocs.map((d) => <li key={d.id} className="caption"><strong>On this phone, not yet sent:</strong> {HC_DOC_LABEL[d.kind]} · {d.title}{d.revision ? ` · ${d.revision}` : ''} · received {fmtDate(d.received_on)}</li>)}
        </ul>
      )}
      <ul className="gaplist">
        {HC_DOC_KINDS.filter((k) => current.has(k) || HC_DOC_EXPECTED.includes(k)).map((k) => {
          const d = current.get(k);
          return (
            <li key={k} className={d ? undefined : 'vr-missing'}>
              <span className="caption">{HC_DOC_LABEL[k]}: </span>{d ? line(d) : 'no copy recorded — ask them for it'}
            </li>
          );
        })}
      </ul>
      {older.length > 0 && (
        <>
          <button type="button" className="linklike" onClick={() => setShowOld(!showOld)}>{showOld ? 'Hide' : 'Show'} {older.length} superseded cop{older.length === 1 ? 'y' : 'ies'}</button>
          {showOld && <ul className="gaplist">{older.map((d) => <li key={d.id} className="caption">{HC_DOC_LABEL[d.kind]}: {line(d)}</li>)}</ul>}
        </>
      )}

      {canManage && !form.open && <button type="button" className="button button--quiet" style={{ marginTop: '0.5rem' }} onClick={() => setForm({ ...form, open: true, on: today })}>Record a plan received</button>}
      {form.open && (
        <div className="item regpanel__form" style={{ marginTop: '0.5rem' }}>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Which plan</span>
              <select id="hcd-kind" className="field field--sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as HcDocKind })}>
                {HC_DOC_KINDS.map((k) => <option key={k} value={k}>{HC_DOC_LABEL[k]}</option>)}
              </select></label>
            <label className="fieldcell"><span className="label">Received on</span><input id="hcd-on" className="field field--sm" type="date" max={today} value={form.on} onChange={(e) => setForm({ ...form, on: e.target.value })} /></label>
          </div>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Title</span><input id="hcd-title" className="field field--sm" placeholder={`${contractor ?? 'Their'} Site ${HC_DOC_LABEL[form.kind]}`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">Revision</span><input id="hcd-rev" className="field field--sm" placeholder="Rev C" value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} /></label>
          </div>
          <label className="fieldcell"><span className="label">Notes</span><input id="hcd-notes" className="field field--sm" placeholder="Crew briefed at prestart, copy in the site shed" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
            {file ? `Chosen: ${file.name}` : 'Attach the copy (optional)'}
            <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {docs.some((d) => d.kind === form.kind && !d.superseded_by) && (
            <label className="fieldcell"><span className="label">Does it replace a copy you have?</span>
              <select id="hcd-replaces" className="field field--sm" value={form.replaces} onChange={(e) => setForm({ ...form, replaces: e.target.value })}>
                <option value="">No — it is a separate plan</option>
                {docs.filter((d) => d.kind === form.kind && !d.superseded_by).map((d) => (
                  <option key={d.id} value={d.id}>Yes — {d.title}{d.revision ? ` ${d.revision}` : ''} (received {fmtDate(d.received_on)})</option>
                ))}
              </select></label>
          )}
          {form.replaces && <p className="caption">The older copy stays on record, marked replaced.</p>}
          <button type="button" className="button" disabled={busy !== null || !form.title.trim()} onClick={() => void act('doc', async () => {
            const supabase = createClient();
            const id = outbox.newId();
            const ext = file ? (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf' : null;
            const path = file ? `${projectId}/${id}.${ext}` : null;
            const contentType = file?.type || 'application/pdf';
            const previous = form.replaces ? docs.find((d) => d.id === form.replaces && !d.superseded_by) ?? null : null;
            if (previous && form.on < previous.received_on) throw new Error(`A copy received ${fmtDate(form.on)} cannot replace one received ${fmtDate(previous.received_on)}. Check the date, or record it as a separate plan.`);
            const row = { id, project_id: projectId, kind: form.kind, title: form.title.trim(), revision: form.revision.trim() || null, received_on: form.on, file_path: path, notes: form.notes.trim() || null };
            const live = async () => {
              if (file && path) {
                const { error: ue } = await supabase.storage.from('head-contractor-docs').upload(path, file, { contentType, upsert: false });
                if (ue) throw new Error(`The file did not upload: ${ue.message}`);
              }
              const { error: e } = await supabase.from('head_contractor_documents').insert(row);
              if (e) throw new Error(e.message);
              if (previous) {
                const { error: se } = await supabase.from('head_contractor_documents').update({ superseded_by: id }).eq('id', previous.id);
                if (se) throw new Error(`Saved, but the older copy was not marked superseded: ${se.message}`);
              }
            };
            const queue = () => outbox.enqueue({ kind: 'hc_document', projectId, subjectId: id, payload: { row, path, contentType, supersedes: previous?.id ?? null }, blobs: file ? { file } : undefined }).then(() => undefined);
            const outcome = await runOrQueue(live, queue);
            if (outcome === 'queued') setError('No signal — saved on this phone with its copy. It sends when you are back in range.');
            setForm({ open: false, kind: form.kind, title: '', revision: '', on: today, notes: '', replaces: '' });
            setFile(null);
            return outcome === 'queued' ? 'queued' : undefined;
          })}>{busy === 'doc' ? 'Saving…' : 'Record it'}</button>
          <button type="button" className="linklike" onClick={() => setForm({ ...form, open: false })}>Cancel</button>
        </div>
      )}
    </section>
  );
}
