'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { KIND_LABEL, coverage, normalisePerson, type ControlledKind } from '@/lib/documents-control/model';
import { IssueForm } from '../new/issue-form';

export interface ProcedureView {
  id: string; orgId: string; title: string; kind: ControlledKind; doc_number: string | null; requires_acknowledgement: boolean; active: boolean;
  versions: Array<{ id: string; version: number; file_path: string; summary: string | null; status: string; issued_at: string; superseded_at: string | null;
    document_acknowledgements: Array<{ id: string; person_name: string; signature_path: string; acknowledged_on_device_at: string; project_id: string | null }> }>;
}
interface Props { doc: ProcedureView; projectId: string; crew: string[]; canManage: boolean; canSign: boolean; userId: string }

export function ProcedureScreen({ doc, projectId, crew, canManage, canSign, userId }: Props) {
  const router = useRouter();
  const current = doc.versions.find((v) => v.status === 'current') ?? null;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [revising, setRevising] = useState(false);
  const acks = current?.document_acknowledgements ?? [];
  const cov = coverage(crew, [...acks.map((a) => a.person_name), ...pending]);
  const signed = new Set([...acks.map((a) => normalisePerson(a.person_name)), ...pending.map(normalisePerson)]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const files = doc.versions.map((v) => v.file_path);
      const next: Record<string, string> = {};
      const { data } = await supabase.storage.from('controlled-docs').createSignedUrls(files, 3600);
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      if (!cancelled) setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [doc.versions]);

  async function acknowledge(blob: Blob) {
    const trimmed = name.trim();
    if (!current) return;
    if (!trimmed) { setError('Name first, then sign.'); return; }
    if (signed.has(normalisePerson(trimmed))) { setError(`${trimmed} has already signed this version.`); return; }
    setBusy(true); setError(null);
    try {
      const ackId = outbox.newId();
      const path = `${projectId}/document/${ackId}/sig.png`;
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('document_acknowledgements').insert({ id: ackId, version_id: current.id, person_name: trimmed, signature_path: path, project_id: projectId, recorded_by: userId, acknowledged_on_device_at: at });
        if (insErr) throw new Error(insErr.message);
      };
      const queue = () => outbox.enqueue({ kind: 'doc_ack', projectId, subjectId: current.id, payload: { ackId, name: trimmed, path, at, by: userId }, blobs: { signature: blob } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome !== 'sent') setPending((p) => [...p, trimmed]);
      setName('');
      if (outcome === 'sent') router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That signature did not save.'); } finally { setBusy(false); }
  }

  return (
    <section className="procedure">
      <p className="label">{KIND_LABEL[doc.kind]}{doc.doc_number ? ` · ${doc.doc_number}` : ''}</p>
      <h1 className="page-title">{doc.title}</h1>
      {current ? (
        <p className="page-subtitle">Version {current.version} · issued {fmtPerthDate(current.issued_at)}{current.summary ? ` — ${current.summary}` : ''}</p>
      ) : <p className="page-subtitle vr-missing">No version issued yet.</p>}
      {current && urls[current.file_path] && <a className="button" href={urls[current.file_path]} target="_blank" rel="noopener">Open the document</a>}

      {canManage && !revising && <button type="button" className="button button--quiet" onClick={() => setRevising(true)}>Issue a new version</button>}
      {revising && (
        <>
          <p className="label" style={{ marginTop: '1rem' }}>New version of {doc.title}</p>
          <IssueForm orgId={doc.orgId} projectId={projectId} userId={userId} documentId={doc.id} existingTitle={doc.title} />
          <button type="button" className="linklike" onClick={() => setRevising(false)}>Not now</button>
        </>
      )}

      {current && doc.requires_acknowledgement && (
        <div className="item">
          <p className="label">Read and understood — version {current.version}</p>
          <h2 className="home-card__title">{crew.length === 0 ? `${acks.length + pending.length} signed · no crew list on this job to check against` : `${cov.read.length} of ${crew.length} on this job${cov.unread.length > 0 ? ` · still to read: ${cov.unread.join(', ')}` : ' · everyone has read it'}`}</h2>
          {pending.map((p) => <div key={p} className="talk-attendee"><span className="talk-attendee__pending" /><span>{p}<span className="pending-tag">waiting for signal</span></span></div>)}
          {acks.map((a) => <div key={a.id} className="talk-attendee"><span className="talk-attendee__pending" /><span>{a.person_name}<span className="caption"> · {fmtPerthDate(a.acknowledged_on_device_at)}</span></span></div>)}
          {canSign && (
            <div className="sigslot item" style={{ marginTop: '1rem' }}>
              <p className="label">Hand them the phone</p>
              <p className="way-hint">They read the document, tap or type their name, and sign: “I have read and understood this.”</p>
              {crew.filter((c) => !signed.has(normalisePerson(c))).length > 0 && (
                <div className="crewchips">{crew.filter((c) => !signed.has(normalisePerson(c))).map((c) => <button key={c} type="button" className={`quotebtn crewchip${name === c ? ' crewchip--on' : ''}`} onClick={() => setName(c)}>+ {c}</button>)}</div>
              )}
              <label className="fieldcell"><span className="label">Name</span><input className="field field--sm" value={name} placeholder="Kel Brady" onChange={(e) => setName(e.target.value)} /></label>
              <SignaturePad saving={busy} onSave={acknowledge} />
            </div>
          )}
        </div>
      )}

      {doc.versions.length > 1 && (
        <div className="item">
          <p className="label">Earlier versions</p>
          {doc.versions.filter((v) => v.status !== 'current').map((v) => (
            <p key={v.id} className="caption">v{v.version} · issued {fmtPerthDate(v.issued_at)}{v.superseded_at ? `, superseded ${fmtPerthDate(v.superseded_at)}` : ''} · {v.document_acknowledgements.length} signed{urls[v.file_path] ? <> · <a href={urls[v.file_path]} target="_blank" rel="noopener">open</a></> : null}{v.summary ? ` — ${v.summary}` : ''}</p>
          ))}
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </section>
  );
}
