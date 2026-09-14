'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { DOC_KINDS, DOC_LABEL, REQUIRED_DOCS, NEEDS_EXPIRY, VERDICT_LABEL, type DocKind, type ComplianceResult } from '@/lib/subcontractors/model';

export interface SubcontractorView {
  id: string; orgId: string; name: string; abn: string | null; trade: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null; active: boolean;
  documents: Array<{ id: string; kind: DocKind; title: string; reference: string | null; issued_on: string | null; expires_on: string | null; file_path: string | null; notes: string | null; active: boolean; created_at: string }>;
  engagement: { project_id: string; scope: string | null; engaged_from: string | null; engaged_to: string | null } | null;
  result: ComplianceResult;
}
interface Props { sub: SubcontractorView; projectId: string; projectName: string; canManage: boolean; userId: string; today: string }

export function SubcontractorScreen({ sub, projectId, projectName, canManage, userId, today }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<DocKind | null>(null);
  const [title, setTitle] = useState(''); const [reference, setReference] = useState(''); const [issued, setIssued] = useState(''); const [expires, setExpires] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState(sub.engagement?.scope ?? '');
  const bad = sub.result.verdict === 'lapsed' || sub.result.verdict === 'missing' || sub.result.verdict === 'none_recorded';

  useEffect(() => {
    const paths = sub.documents.map((d) => d.file_path).filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('subcontractor-docs').createSignedUrls(paths, 3600);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [sub.documents]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const addDoc = () => run('save the document', async () => {
    if (!adding) return;
    if (!title.trim()) throw new Error('Give the document a title — the insurer and policy, or the licence.');
    if (issued && expires && expires < issued) throw new Error('It cannot expire before it was issued.');
    const supabase = createClient();
    if (NEEDS_EXPIRY.includes(adding) && !expires) throw new Error('Insurance has a term — record the expiry date.');
    // The file first, then the row that names it: a row is never left pointing
    // at nothing, and a file left without its row is removed here and reported
    // by the nightly check if that fails too.
    const id = crypto.randomUUID();
    const ext = file ? (file.name.split('.').pop()?.toLowerCase() || 'pdf') : null;
    const filePath = file ? `${sub.orgId}/${sub.id}/${id}.${ext}` : null;
    if (file && filePath) {
      const { error: upErr } = await supabase.storage.from('subcontractor-docs').upload(filePath, file, { contentType: file.type || 'application/pdf', upsert: false });
      if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
    }
    const { error: e } = await supabase.from('subcontractor_documents').insert({ id, subcontractor_id: sub.id, kind: adding, title: title.trim(), reference: reference.trim() || null, issued_on: issued || null, expires_on: expires || null, file_path: filePath, created_by: userId });
    if (e) {
      if (filePath) await supabase.storage.from('subcontractor-docs').remove([filePath]).catch(() => undefined);
      throw new Error(e.message);
    }
    setAdding(null); setTitle(''); setReference(''); setIssued(''); setExpires(''); setFile(null);
  });
  const retire = (id: string) => run('retire the document', async () => {
    const { data, error: e } = await createClient().from('subcontractor_documents').update({ active: false }).eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const engage = () => run('engage on this job', async () => {
    const { error: e } = await createClient().from('project_subcontractors').insert({ project_id: projectId, subcontractor_id: sub.id, scope: scope.trim() || null, engaged_from: today, created_by: userId });
    if (e) throw new Error(e.message);
  });
  const disengage = () => run('finish on this job', async () => {
    const { error: e } = await createClient().from('project_subcontractors').update({ engaged_to: today }).eq('project_id', projectId).eq('subcontractor_id', sub.id);
    if (e) throw new Error(e.message);
  });
  const retireCompany = () => run('retire the company', async () => {
    if (!window.confirm('Retire this subcontractor? Its records stay; it drops off the lists.')) return;
    const { error: e } = await createClient().from('subcontractors').update({ active: false }).eq('id', sub.id);
    if (e) throw new Error(e.message);
  });

  return (
    <section className="subbie">
      <p className="label">{sub.trade ?? 'Subcontractor'}{sub.abn ? ` · ABN ${sub.abn}` : ''}</p>
      <h1 className="page-title">{sub.name}</h1>
      <p className={`page-subtitle ${bad ? 'vr-missing' : sub.result.verdict === 'compliant' ? 'swms__status--active' : ''}`}>{VERDICT_LABEL[sub.result.verdict]}{!sub.active ? ' · retired' : ''}</p>
      {(sub.contact_name || sub.contact_phone || sub.contact_email) && <p className="caption">{[sub.contact_name, sub.contact_phone, sub.contact_email].filter(Boolean).join(' · ')}</p>}

      <div className="item">
        <p className="label">Required to be on site</p>
        {REQUIRED_DOCS.map((k) => {
          const state = sub.result.lapsed.includes(k) ? 'lapsed' : sub.result.missing.includes(k) ? 'missing' : sub.result.expiring.find((e) => e.kind === k) ? 'expiring' : 'ok';
          const exp = sub.result.expiring.find((e) => e.kind === k);
          return (
            <p key={k} className={`subbie__req${state === 'ok' ? '' : state === 'expiring' ? ' subbie__req--soon' : ' subbie__req--bad'}`}>
              {DOC_LABEL[k]} — {state === 'ok' ? 'current' : state === 'expiring' ? `expires ${fmtDate(exp?.expires_on ?? null)}` : state}
            </p>
          );
        })}
      </div>

      <div className="item">
        <p className="label">Documents</p>
        {sub.documents.length === 0 && <p className="nil">Nothing recorded yet.</p>}
        {sub.documents.map((d) => {
          const lapsed = d.active && d.expires_on != null && d.expires_on < today;
          return (
            <div key={d.id} className={`incident__action${d.active ? '' : ' incident__action--done'}${lapsed ? ' incident__action--late' : ''}`}>
              <div>
                <p className="incident__text"><strong>{DOC_LABEL[d.kind]}</strong> · {d.title}{d.reference ? ` · ${d.reference}` : ''}</p>
                <p className="caption">{d.issued_on ? `issued ${fmtDate(d.issued_on)} · ` : ''}{d.expires_on ? `expires ${fmtDate(d.expires_on)}` : 'no expiry'}{lapsed ? ' · LAPSED' : ''}{!d.active ? ' · retired' : ''}{d.file_path && urls[d.file_path] ? <> · <a href={urls[d.file_path]} target="_blank" rel="noopener">open the file</a></> : ''}</p>
              </div>
              {d.active && canManage && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void retire(d.id)}>Retire</button>}
            </div>
          );
        })}
        {canManage && sub.active && !adding && (
          <div className="crewchips" style={{ marginTop: '0.75rem' }}>
            {DOC_KINDS.map((k) => <button key={k} type="button" className="quotebtn crewchip" onClick={() => { setAdding(k); setTitle(''); }}>+ {DOC_LABEL[k]}</button>)}
          </div>
        )}
        {adding && (
          <div className="incident__add">
            <p className="label">{DOC_LABEL[adding]}</p>
            <label className="fieldcell"><span className="label">Title</span><input className="field field--sm" value={title} placeholder="Insurer and policy, or the licence class" onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Policy or licence number</span><input className="field field--sm" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Issued</span><input className="field field--sm" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} /></label>
              <label className="fieldcell"><span className="label">Expires</span><input className="field field--sm" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
            </div>
            <label className="fieldcell"><span className="label">The certificate (PDF or photo)</span><input className="field field--sm" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <div className="photo-add-pair">
              <button type="button" className="button" disabled={busy != null} onClick={() => void addDoc()}>{busy === 'save the document' ? 'Saving…' : 'Save'}</button>
              <button type="button" className="button button--quiet" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="item">
        <p className="label">On {projectName}</p>
        {sub.engagement ? (
          <p>{sub.engagement.scope ?? 'Engaged'}{sub.engagement.engaged_from ? ` · from ${fmtDate(sub.engagement.engaged_from)}` : ''}{sub.engagement.engaged_to ? ` · to ${fmtDate(sub.engagement.engaged_to)}` : ''}</p>
        ) : <p className="nil">Not engaged on this job.</p>}
        {canManage && sub.active && !sub.engagement && (
          <>
            <input className="field field--sm" value={scope} placeholder="Scope — what they are doing here" onChange={(e) => setScope(e.target.value)} />
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void engage()}>Engage on this job</button>
          </>
        )}
        {canManage && sub.engagement && !sub.engagement.engaged_to && <button type="button" className="linklike" disabled={busy != null} onClick={() => void disengage()}>Finished on this job</button>}
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {canManage && sub.active && <button type="button" className="linklike" disabled={busy != null} onClick={() => void retireCompany()}>Retire this subcontractor</button>}
    </section>
  );
}
