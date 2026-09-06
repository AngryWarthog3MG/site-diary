'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';

export interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  revision: string | null;
  filename: string;
  mime_type: string;
  bytes: number;
  pages: number | null;
  chars: number;
  status: 'uploaded' | 'indexing' | 'ready' | 'failed';
  error: string | null;
  method: string | null;
  created_at: string;
  indexed_at: string | null;
}

const KINDS: Array<[string, string]> = [
  ['specification', 'Specification'],
  ['scope', 'Scope of works'],
  ['contract', 'Contract'],
  ['drawing', 'Drawings / register'],
  ['safety', 'Safety plan / SWMS'],
  ['programme', 'Programme'],
  ['other', 'Other'],
];
const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,.webp,.txt';

function guessKind(name: string): string {
  const n = name.toLowerCase();
  if (/spec/.test(n)) return 'specification';
  if (/scope|sow/.test(n)) return 'scope';
  if (/contract|agreement|subcontract/.test(n)) return 'contract';
  if (/drawing|dwg|plan|sheet/.test(n)) return 'drawing';
  if (/swms|safety|hsms|whs/.test(n)) return 'safety';
  if (/program/.test(n)) return 'programme';
  return 'other';
}

/**
 * Upload goes straight to storage under the caller's own RLS, the row is
 * inserted the same way, and then the server reads the file into search
 * chunks. Each file reports its own progress; a failure says why and offers
 * a re-read, so a bad scan does not block the rest.
 */
export function DocumentsManager({ projectId, userId, initial }: { projectId: string; userId: string; initial: DocumentRow[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('specification');
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (files.length === 0) return;
    setBusy('upload');
    setError(null);
    const supabase = createClient();
    for (const file of files) {
      const key = file.name;
      // The same file twice is the same document twice; a double tap on the phone should not.
      if (initial.some((d) => d.filename === file.name && d.bytes === file.size)) {
        setProgress((p) => ({ ...p, [key]: 'Already on this job — skipped' }));
        continue;
      }
      try {
        setProgress((p) => ({ ...p, [key]: 'Uploading…' }));
        const id = crypto.randomUUID();
        const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
        const path = `${projectId}/documents/${id}/${safeName}`;
        const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const { error: upErr } = await supabase.storage.from('project-documents').upload(path, file, { contentType: mime, upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('project_documents').insert({
          id,
          project_id: projectId,
          title: (files.length === 1 && title.trim()) ? title.trim() : file.name.replace(/\.[^.]+$/, ''),
          kind: files.length === 1 ? kind : guessKind(file.name),
          revision: revision.trim() || null,
          filename: file.name,
          storage_path: path,
          mime_type: mime,
          bytes: file.size,
          uploaded_by: userId,
        });
        if (insErr) throw new Error(insErr.message);
        setProgress((p) => ({ ...p, [key]: 'Reading…' }));
        const res = await fetch(`/api/documents/${id}/index`, { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        setProgress((p) => ({ ...p, [key]: res.ok ? `Ready · ${json.chunks} passages` : `Could not read: ${json?.error?.message ?? res.status}` }));
      } catch (err) {
        setProgress((p) => ({ ...p, [key]: `Failed: ${err instanceof Error ? err.message : 'unknown'}` }));
      }
    }
    setFiles([]);
    setTitle('');
    setRevision('');
    setBusy(null);
    router.refresh();
  }

  async function reindex(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}/index`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json?.error?.message ?? 'Could not read the document.');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function rename(doc: DocumentRow) {
    const next = window.prompt('Title for this document', doc.title);
    if (next == null || !next.trim() || next.trim() === doc.title) return;
    setBusy(doc.id);
    setError(null);
    try {
      const { error: upErr } = await createClient().from('project_documents').update({ title: next.trim() }).eq('id', doc.id);
      if (upErr) setError(upErr.message);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(doc: DocumentRow) {
    if (!window.confirm(`Remove "${doc.title}"? Ask will no longer see it.`)) return;
    setBusy(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json?.error?.message ?? 'Could not remove it.');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const mb = (b: number) => `${(b / 1048576).toFixed(b < 1048576 ? 2 : 1)} MB`;

  return (
    <>
      <section className="item docs-add">
        <p className="label">Add documents</p>
        <label className="fieldcell">
          <span className="label">Files</span>
          <input className="field" type="file" accept={ACCEPT} multiple
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              setFiles(list);
              if (list.length === 1) { setTitle(list[0].name.replace(/\.[^.]+$/, '')); setKind(guessKind(list[0].name)); }
            }} />
        </label>
        {files.length === 1 && (
          <>
            <label className="fieldcell">
              <span className="label">Title</span>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="fieldgrid">
              <label className="fieldcell">
                <span className="label">Kind</span>
                <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="fieldcell">
                <span className="label">Revision</span>
                <input className="field field--sm" value={revision} placeholder="C" onChange={(e) => setRevision(e.target.value)} />
              </label>
            </div>
          </>
        )}
        {files.length > 1 && <p className="way-hint">{files.length} files. Each is titled from its filename; you can tidy titles after.</p>}
        <button className="button" type="button" disabled={busy !== null || files.length === 0} onClick={upload}>
          {busy === 'upload' ? 'Working…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload and read'}
        </button>
        {Object.entries(progress).map(([name, state]) => (
          <p key={name} className="way-hint"><span className="mono">{name}</span> — {state}</p>
        ))}
        <p className="way-hint">PDF, Word, photos of pages, or text. Scans are read page by page; a long scan takes a few minutes.</p>
      </section>

      {error && <p className="alert">{error}</p>}

      <p className="label" style={{ marginTop: '1rem' }}>On this job · {initial.length}</p>
      {initial.length === 0 ? (
        <p className="claims-nil">Nothing uploaded yet. Start with the specification — it answers most questions.</p>
      ) : (
        <ul className="docs-list">
          {initial.map((doc) => (
            <li key={doc.id} className={`docs-card docs-card--${doc.status}`}>
              <div className="docs-card__head">
                <span className="docs-card__title">{doc.title}{doc.revision ? <span className="mono"> rev {doc.revision}</span> : null}</span>
                <span className={`docs-status docs-status--${doc.status}`}>
                  {doc.status === 'ready' ? 'Ready' : doc.status === 'indexing' ? 'Reading…' : doc.status === 'failed' ? 'Could not read' : 'Uploaded'}
                </span>
              </div>
              <p className="docs-card__meta">
                {kindLabel(doc.kind)} · {mb(doc.bytes)}
                {doc.pages != null ? ` · ${doc.pages} page${doc.pages === 1 ? '' : 's'}` : ''}
                {doc.status === 'ready' && doc.method === 'vision' ? ' · read from a scan' : ''}
                {' · added '}{fmtDate(doc.created_at.slice(0, 10))}
              </p>
              {doc.status === 'failed' && doc.error && <p className="alert">{doc.error}</p>}
              <div className="docs-card__actions">
                <button className="linklike" type="button" disabled={busy !== null} onClick={() => rename(doc)}>Rename</button>
                {(doc.status === 'failed' || doc.status === 'uploaded') && (
                  <button className="linklike" type="button" disabled={busy !== null} onClick={() => reindex(doc.id)}>
                    {busy === doc.id ? 'Reading…' : 'Read again'}
                  </button>
                )}
                <button className="linklike linklike--danger" type="button" disabled={busy !== null} onClick={() => remove(doc)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <hr className="rule" />
      <Link className="button button--quiet" href={`/ask?project=${projectId}`}>Ask a question</Link>
    </>
  );
}
