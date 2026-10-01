'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DOC_KINDS, KIND_LABEL, AUDIENCE_LABEL, type ControlledKind } from '@/lib/documents-control/model';
import { QuestionsEditor, type DraftQuestion, saveQuestions } from './questions-editor';

export interface ExistingDoc {
  title: string; kind: ControlledKind; doc_number: string | null; audience: string[]; ack_due_days: number;
  review_interval_months: number | null; pass_mark: number | null; requires_acknowledgement: boolean;
}
interface Props { orgId: string; projectId: string; userId: string; documentId?: string; existing?: ExistingDoc }

const ROLES = Object.keys(AUDIENCE_LABEL);

/**
 * A new document and its first version, or a new version of one that exists
 * (README R120). The file goes up first, then the version — as a DRAFT, so the
 * questions can be set beside it; "Issue now" then flips it to current, which
 * supersedes, assigns and tells people. "Save as draft" leaves it for later,
 * and nobody is told anything.
 */
export function IssueForm({ orgId, projectId, userId, documentId, existing }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [kind, setKind] = useState<ControlledKind>(existing?.kind ?? 'procedure');
  const [number, setNumber] = useState(existing?.doc_number ?? '');
  const [requiresAck, setRequiresAck] = useState(existing?.requires_acknowledgement ?? true);
  const [audience, setAudience] = useState<string[]>(existing?.audience ?? []);
  const [dueDays, setDueDays] = useState(String(existing?.ack_due_days ?? 14));
  const [reviewMonths, setReviewMonths] = useState(existing?.review_interval_months != null ? String(existing.review_interval_months) : '12');
  const [passMark, setPassMark] = useState<string>(existing?.pass_mark != null ? String(existing.pass_mark) : '100');
  const [summary, setSummary] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [busy, setBusy] = useState<'draft' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(issue: boolean) {
    setBusy(issue ? 'issue' : 'draft'); setError(null);
    try {
      if (!documentId && !title.trim()) throw new Error('The document needs a title.');
      if (!file) throw new Error('Attach the document — a PDF.');
      if (file.size > 50 * 1024 * 1024) throw new Error('The file is over 50 MB.');
      const ext0 = file.name.split('.').pop()?.toLowerCase() ?? '';
      const okType = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || (!file.type && ['pdf', 'jpg', 'jpeg', 'png'].includes(ext0));
      if (!okType) throw new Error('The document must be a PDF (or a JPEG/PNG scan).');
      const days = Number(dueDays); if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Days to sign: a whole number, 1 to 365.');
      const months = reviewMonths.trim() === '' ? null : Number(reviewMonths); if (months != null && (!Number.isInteger(months) || months < 1 || months > 120)) throw new Error('Review interval: whole months, 1 to 120, or blank.');
      const pm = questions.length > 0 ? Number(passMark) : (existing?.pass_mark ?? null);
      for (const q of questions) { if (!q.prompt.trim()) throw new Error('Every question needs its wording.'); if (q.options.filter((o) => o.trim()).length < 2) throw new Error('Every question needs at least two answers.'); if (!q.options[q.correct]?.trim()) throw new Error('Mark the right answer on every question.'); }

      const supabase = createClient();
      const facts = { title: title.trim(), kind, doc_number: number.trim() || null, requires_acknowledgement: requiresAck, audience, ack_due_days: days, review_interval_months: months, pass_mark: pm };
      let docId = documentId ?? null;
      if (!docId) {
        const { data, error: e } = await supabase.from('controlled_documents').insert({ org_id: orgId, ...facts, created_by: userId }).select('id').single();
        if (e) throw new Error(/controlled_documents_title_idx/.test(e.message) ? 'A document with that title exists — open it and issue a new version.' : e.message);
        docId = data.id as string;
      } else {
        const { error: e } = await supabase.from('controlled_documents').update(facts).eq('id', docId);
        if (e) throw new Error(e.message);
      }
      const versionId = crypto.randomUUID();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const path = `${orgId}/${docId}/${versionId}.${ext}`;
      const contentType = file.type || (ext0 === 'pdf' ? 'application/pdf' : ext0 === 'png' ? 'image/png' : 'image/jpeg');
      const { error: upErr } = await supabase.storage.from('controlled-docs').upload(path, file, { contentType, upsert: false });
      if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
      const { error: vErr } = await supabase.from('document_versions').insert({ id: versionId, document_id: docId, file_path: path, summary: summary.trim() || null, change_summary: summary.trim() || null, status: 'draft', issued_by: userId });
      if (vErr) { await supabase.storage.from('controlled-docs').remove([path]).catch(() => undefined); throw new Error(vErr.message); }
      if (questions.length > 0) await saveQuestions(supabase, versionId, questions);
      if (issue) {
        const { error: iErr } = await supabase.from('document_versions').update({ status: 'current' }).eq('id', versionId);
        if (iErr) throw new Error(`Saved as a draft, but it did not issue: ${iErr.message}`);
        await fetch('/api/procedures/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ versionId }) }).catch(() => undefined);
      }
      router.push(`/procedures/${docId}?project=${projectId}`);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); setBusy(null); }
  }

  const toggleRole = (r: string) => setAudience((a) => (a.includes(r) ? a.filter((x) => x !== r) : [...a, r]));

  return (
    <div className="item">
      {!documentId && (
        <div className="regs__fields">
          <label className="fieldcell regs__field regs__field--wide"><span className="label">Title</span><input className="field field--sm" value={title} placeholder="Working near underground services" onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="fieldcell regs__field"><span className="label">Kind</span>
            <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as ControlledKind)}>{DOC_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <label className="fieldcell regs__field"><span className="label">Document number</span><input className="field field--sm" value={number} placeholder="PRO-014" onChange={(e) => setNumber(e.target.value)} /></label>
        </div>
      )}
      <p className="label regs__sub">Who must read and sign it</p>
      <div className="regs__ticks regs__ticks--dense">
        <label className="regs__tick"><input type="checkbox" checked={audience.length === 0} onChange={() => setAudience([])} /><span>Everyone on the company&rsquo;s jobs</span></label>
        {ROLES.map((r) => <label key={r} className="regs__tick"><input type="checkbox" checked={audience.includes(r)} onChange={() => toggleRole(r)} /><span>{AUDIENCE_LABEL[r]}</span></label>)}
      </div>
      <div className="regs__fields" style={{ marginTop: '.6rem' }}>
        <label className="fieldcell regs__field"><span className="label">Days to sign</span><input className="field field--sm" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></label>
        <label className="fieldcell regs__field"><span className="label">Reviewed every (months)</span><input className="field field--sm" inputMode="numeric" value={reviewMonths} onChange={(e) => setReviewMonths(e.target.value)} /></label>
        <label className="fieldcell regs__field"><span className="label">Needs a signature?</span>
          <select className="field field--sm" value={requiresAck ? 'yes' : 'no'} onChange={(e) => setRequiresAck(e.target.value === 'yes')}><option value="yes">Yes — read and sign</option><option value="no">No — reference only</option></select></label>
      </div>
      <div className="regs__fields" style={{ marginTop: '.6rem' }}>
        <label className="fieldcell regs__field regs__field--wide"><span className="label">{documentId ? 'What changed in this version' : 'Summary'}</span><input className="field field--sm" value={summary} placeholder={documentId ? 'Section 4 rewritten for the new permit form' : 'What it covers, in a line'} onChange={(e) => setSummary(e.target.value)} /></label>
        <label className="fieldcell regs__field"><span className="label">The document (PDF)</span><input className="field field--sm" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>

      <p className="label regs__sub">Comprehension check — optional</p>
      <p className="caption">Questions the reader must get right before the signature panel opens. The right answers are graded on the server and never sent to the phone. Every attempt is recorded.</p>
      <QuestionsEditor draft={questions} onChange={setQuestions} passMark={Number(passMark)} onPassMark={(v) => setPassMark(String(v))} />

      <div className="regs__actions">
        <button className="button" type="button" disabled={busy !== null} onClick={() => void save(true)}>{busy === 'issue' ? 'Issuing…' : 'Issue now'}</button>
        <button className="button button--quiet" type="button" disabled={busy !== null} onClick={() => void save(false)}>{busy === 'draft' ? 'Saving…' : 'Save as a draft'}</button>
        <span className="caption">Issue now supersedes the last version, assigns everyone it binds and tells them. A draft tells nobody.</span>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
