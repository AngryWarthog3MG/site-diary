'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DOC_KINDS, KIND_LABEL, type ControlledKind } from '@/lib/documents-control/model';

interface Props { orgId: string; projectId: string; userId: string; documentId?: string; existingTitle?: string }

/**
 * A new document and its first version, or a new version of one that exists.
 * The file goes up first, then the row that names it; a failed row removes
 * the file, so nothing is left pointing at nothing.
 */
export function IssueForm({ orgId, projectId, userId, documentId, existingTitle }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(existingTitle ?? '');
  const [kind, setKind] = useState<ControlledKind>('procedure');
  const [number, setNumber] = useState('');
  const [requiresAck, setRequiresAck] = useState(true);
  const [summary, setSummary] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true); setError(null);
    try {
      if (!documentId && !title.trim()) throw new Error('The document needs a title.');
      if (!file) throw new Error('Attach the document — a PDF.');
      if (file.size > 50 * 1024 * 1024) throw new Error('The file is over 50 MB.');
      const supabase = createClient();
      let docId = documentId ?? null;
      if (!docId) {
        const { data, error: e } = await supabase.from('controlled_documents').insert({ org_id: orgId, title: title.trim(), kind, doc_number: number.trim() || null, requires_acknowledgement: requiresAck, created_by: userId }).select('id').single();
        if (e) throw new Error(/controlled_documents_title_idx/.test(e.message) ? 'A document with that title exists — open it and issue a new version.' : e.message);
        docId = data.id as string;
      }
      const versionId = crypto.randomUUID();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const path = `${orgId}/${docId}/${versionId}.${ext}`;
      const { error: upErr } = await supabase.storage.from('controlled-docs').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
      if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
      const { error: vErr } = await supabase.from('document_versions').insert({ id: versionId, document_id: docId, file_path: path, summary: summary.trim() || null, issued_by: userId });
      if (vErr) { await supabase.storage.from('controlled-docs').remove([path]).catch(() => undefined); throw new Error(vErr.message); }
      router.push(`/procedures/${docId}?project=${projectId}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not issue.'); setBusy(false); }
  }

  return (
    <div className="item">
      {!documentId && (
        <>
          <label className="fieldcell"><span className="label">Title</span><input className="field field--sm" value={title} placeholder="Working near underground services" onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Kind</span>
              <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as ControlledKind)}>{DOC_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
            <label className="fieldcell"><span className="label">Number</span><input className="field field--sm" value={number} placeholder="KBS-WHS-012" onChange={(e) => setNumber(e.target.value)} /></label>
          </div>
          <label className={`checkrow${requiresAck ? ' checkrow--on' : ''}`}><input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} /><span>The crew must read and sign this</span></label>
        </>
      )}
      <label className="fieldcell"><span className="label">{documentId ? 'What changed in this version' : 'Summary'}</span><textarea className="field field--sm" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
      <label className="fieldcell"><span className="label">The document (PDF)</span><input className="field field--sm" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      {error && <p className="alert" role="alert">{error}</p>}
      <button type="button" className="button" disabled={busy} onClick={() => void issue()}>{busy ? 'Issuing…' : documentId ? 'Issue the new version' : 'Issue'}</button>
      <p className="caption">Issuing supersedes the current version; everyone reads and signs again.</p>
    </div>
  );
}
