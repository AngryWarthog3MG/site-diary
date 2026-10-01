'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DOC_KINDS, KIND_LABEL, AUDIENCE_LABEL, parseImportFilename, normalisePerson, type ControlledKind } from '@/lib/documents-control/model';

interface Existing { id: string; title: string; doc_number: string | null }
interface Row { file: File; title: string; code: string; kind: ControlledKind; versionNote: string | null; matches: Existing | null; outcome?: string }

const MAX_FILES = 40;
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The import table (README R120): one row per file, read off the name, edited
 * by hand, then saved. A file whose title matches a document already on the
 * register becomes a new version of it rather than a duplicate. Each row is
 * file first, then the version row; a refused row clears its file.
 */
export function ImportForm({ orgId, projectId, userId, existing }: { orgId: string; projectId: string; userId: string; existing: Existing[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [dueDays, setDueDays] = useState('14');
  const [requiresAck, setRequiresAck] = useState(true);
  const [busy, setBusy] = useState<'draft' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const findExisting = (title: string, code: string) =>
    existing.find((e) => normalisePerson(e.title) === normalisePerson(title) || (code && e.doc_number && e.doc_number.toLowerCase() === code.toLowerCase())) ?? null;

  function pick(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files).slice(0, MAX_FILES);
    setError(picked.length < files.length ? `Only the first ${MAX_FILES} files were taken.` : null);
    setRows(picked.map((file) => {
      const p = parseImportFilename(file.name);
      const code = p.code ?? '';
      return { file, title: p.title, code, kind: p.kind ?? 'procedure', versionNote: p.versionNote, matches: findExisting(p.title, code) };
    }));
    setDone(null);
  }
  const edit = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, matches: findExisting(patch.title ?? r.title, patch.code ?? r.code) } : r)));
  const toggleRole = (r: string) => setAudience((a) => (a.includes(r) ? a.filter((x) => x !== r) : [...a, r]));

  async function run(issue: boolean) {
    setBusy(issue ? 'issue' : 'draft'); setError(null); setDone(null);
    const days = Number(dueDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) { setError('Days to sign: a whole number, 1 to 365.'); setBusy(null); return; }
    const supabase = createClient();
    let okCount = 0;
    const out: Row[] = [];
    for (const r of rows) {
      try {
        if (!r.title.trim()) throw new Error('No title.');
        if (r.file.size > MAX_BYTES) throw new Error('Over 25 MB.');
        const ext0 = r.file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!(r.file.type === 'application/pdf' || (!r.file.type && ext0 === 'pdf'))) throw new Error('Not a PDF.');
        let docId = r.matches?.id ?? null;
        if (!docId) {
          const { data, error: e } = await supabase.from('controlled_documents').insert({ org_id: orgId, title: r.title.trim(), kind: r.kind, doc_number: r.code.trim() || null, requires_acknowledgement: requiresAck, audience, ack_due_days: days, created_by: userId }).select('id').single();
          if (e) throw new Error(e.message);
          docId = data.id as string;
        }
        const versionId = crypto.randomUUID();
        const path = `${orgId}/${docId}/${versionId}.pdf`;
        const { error: upErr } = await supabase.storage.from('controlled-docs').upload(path, r.file, { contentType: 'application/pdf', upsert: false });
        if (upErr) throw new Error(`Upload: ${upErr.message}`);
        const note = r.versionNote ? `Imported from ${r.file.name} (version ${r.versionNote} on the file)` : `Imported from ${r.file.name}`;
        const { error: vErr } = await supabase.from('document_versions').insert({ id: versionId, document_id: docId, file_path: path, summary: note, change_summary: note, status: 'draft', issued_by: userId });
        if (vErr) { await supabase.storage.from('controlled-docs').remove([path]).catch(() => undefined); throw new Error(vErr.message); }
        if (issue) {
          const { error: iErr } = await supabase.from('document_versions').update({ status: 'current' }).eq('id', versionId);
          if (iErr) throw new Error(`Saved as a draft, but did not issue: ${iErr.message}`);
          await fetch('/api/procedures/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ versionId }) }).catch(() => undefined);
        }
        okCount += 1;
        out.push({ ...r, outcome: r.matches ? (issue ? 'Issued as a new version' : 'Draft, new version') : (issue ? 'Issued' : 'Draft') });
      } catch (e) {
        out.push({ ...r, outcome: `Not saved — ${e instanceof Error ? e.message : 'failed'}` });
      }
    }
    setRows(out);
    setDone(`${okCount} of ${rows.length} ${issue ? 'issued' : 'saved as drafts'}.${issue ? ' Everyone in the audience has been told.' : ' Open each one under Policies & procedures to add questions and issue it.'}`);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="item">
      <label className="fieldcell"><span className="label">PDF files</span><input className="field field--sm" type="file" accept="application/pdf" multiple onChange={(e) => pick(e.target.files)} /></label>
      {rows.length > 0 && (
        <>
          <p className="label regs__sub">Who must read and sign them · the same for every file in this import</p>
          <div className="regs__ticks regs__ticks--dense">
            <label className="regs__tick"><input type="checkbox" checked={audience.length === 0} onChange={() => setAudience([])} /><span>Everyone on the company&rsquo;s jobs</span></label>
            {Object.keys(AUDIENCE_LABEL).map((r) => <label key={r} className="regs__tick"><input type="checkbox" checked={audience.includes(r)} onChange={() => toggleRole(r)} /><span>{AUDIENCE_LABEL[r]}</span></label>)}
          </div>
          <div className="regs__fields" style={{ marginTop: '.6rem' }}>
            <label className="fieldcell regs__field"><span className="label">Days to sign</span><input className="field field--sm" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></label>
            <label className="fieldcell regs__field"><span className="label">Needs a signature?</span>
              <select className="field field--sm" value={requiresAck ? 'yes' : 'no'} onChange={(e) => setRequiresAck(e.target.value === 'yes')}><option value="yes">Yes — read and sign</option><option value="no">No — reference only</option></select></label>
          </div>
          <table className="docs__table" style={{ marginTop: '.75rem' }}>
            <thead><tr><th>File</th><th>Code</th><th>Title</th><th>Kind</th><th>Becomes</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.file.name}-${i}`}>
                  <td className="caption">{r.file.name}<br />{(r.file.size / 1048576).toFixed(1)} MB{r.versionNote ? ` · v${r.versionNote} on the name` : ''}</td>
                  <td><input className="field field--sm" value={r.code} onChange={(e) => edit(i, { code: e.target.value })} disabled={busy !== null} /></td>
                  <td><input className="field field--sm" value={r.title} onChange={(e) => edit(i, { title: e.target.value })} disabled={busy !== null} /></td>
                  <td><select className="field field--sm" value={r.kind} onChange={(e) => edit(i, { kind: e.target.value as ControlledKind })} disabled={busy !== null}>{DOC_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                  <td className="caption">{r.outcome ?? (r.matches ? `New version of “${r.matches.title}”` : 'New document')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="regs__actions">
            <button type="button" className="button" disabled={busy !== null} onClick={() => void run(false)}>{busy === 'draft' ? 'Saving…' : `Import ${rows.length} as drafts`}</button>
            <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void run(true)}>{busy === 'issue' ? 'Issuing…' : 'Issue all now'}</button>
          </div>
        </>
      )}
      {done && <p className="notice" role="status">{done}</p>}
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
