'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { KIND_LABEL, type SwmsKind } from '@/lib/swms/model';

/**
 * The SWMS you already have (README R89): the document, a title, and it is in
 * use — no steps to type, because the document is the method statement. The
 * file goes up first and the row straight after, with the file removed if
 * the row is refused, the same order as an issued procedure; then it is put
 * into use in the same breath, so the crew can sign on the moment it lands.
 */
export function UploadSwmsForm({ projectId, userId, preparedBy }: { projectId: string; userId: string; preparedBy: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<SwmsKind>('swms');
  const [title, setTitle] = useState('');
  const [activity, setActivity] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    setError(null);
    if (!title.trim()) { setError('What work is it for? A title.'); return; }
    if (!file) { setError('Pick the document — a PDF, or a photo of each page.'); return; }
    setBusy(true);
    const supabase = createClient();
    const id = crypto.randomUUID();
    const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
    const path = `${projectId}/${id}.${ext}`;
    try {
      const { error: upErr } = await supabase.storage.from('swms-docs').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
      if (upErr) throw new Error(`The document did not upload: ${upErr.message}`);
      const { error: rowErr } = await supabase.from('swms').insert({
        id, project_id: projectId, kind, title: title.trim(), activity: activity.trim() || null,
        prepared_by: preparedBy || null, file_path: path, file_name: file.name, created_by: userId,
      });
      if (rowErr) {
        await supabase.storage.from('swms-docs').remove([path]).catch(() => undefined);
        throw new Error(rowErr.message);
      }
      // In use straight away: a filed SWMS is complete on its own terms. If the
      // database disagrees it stays a draft and the page says why.
      const { error: actErr } = await supabase.from('swms').update({ status: 'active' }).eq('id', id);
      router.push(`/swms/${id}${actErr ? '?draft=1' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
      setBusy(false);
    }
  }

  return (
    <div className="item">
      <p className="caption">
        The document is the method statement — the crew read it and sign on to it. Nothing else to fill in. It is in use
        the moment it lands; a change later is a new version.
      </p>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Kind</span>
          <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as SwmsKind)}>
            {(['swms', 'jsa'] as SwmsKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select></label>
        <label className="fieldcell"><span className="label">Title — the work it covers</span>
          <input className="field field--sm" value={title} placeholder="Trenching beside live services" onChange={(e) => setTitle(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">Where, or which part of the job</span>
        <input className="field field--sm" value={activity} placeholder="Old Brand Drive irrigation mainline" onChange={(e) => setActivity(e.target.value)} /></label>
      <label className="fieldcell"><span className="label">The document</span>
        <input className="field field--sm" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      {error && <p className="alert">{error}</p>}
      <div className="claims-actions">
        <button type="button" className="button" disabled={busy} onClick={upload}>{busy ? 'Filing…' : 'File it and put it into use'}</button>
      </div>
    </div>
  );
}
