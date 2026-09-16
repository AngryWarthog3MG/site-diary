'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';

const KINDS = ['major_nonconformity', 'minor_nonconformity', 'observation', 'opportunity'] as const;
const KIND_LABEL: Record<string, string> = {
  major_nonconformity: 'Major nonconformity', minor_nonconformity: 'Minor nonconformity', observation: 'Observation', opportunity: 'Opportunity for improvement',
};

interface Audit { id: string; date: string; scope: string; criteria: string; auditor: string; independent: boolean; previousReview: string; summary: string; status: 'draft' | 'issued'; issuedOn: string | null; onSchedule: boolean }
interface Finding { id: string; seq: number; kind: string; clause: string | null; finding: string; action: string | null; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null }

const perthDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);

export function AuditScreen({ audit, findings, previousSummary, canWrite }: { audit: Audit; findings: Finding[]; previousSummary: string; canWrite: boolean }) {
  const router = useRouter();
  const draft = audit.status === 'draft';
  const [f, setF] = useState({ scope: audit.scope, criteria: audit.criteria, auditor: audit.auditor, independent: audit.independent, previousReview: audit.previousReview || previousSummary, summary: audit.summary });
  const [nf, setNf] = useState({ kind: 'minor_nonconformity', clause: '', finding: '', action: '', owner: '', due: '' });
  const [doneNote, setDoneNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }
  const fields = () => ({ scope: f.scope.trim(), criteria: f.criteria.trim(), auditor_name: f.auditor.trim(), auditor_independent: f.independent, previous_actions_review: f.previousReview.trim() || null, summary: f.summary.trim() || null });
  const ro = !draft || !canWrite;
  const days = audit.issuedOn ? Math.round((Date.parse(`${audit.issuedOn}T00:00:00Z`) - Date.parse(`${audit.date}T00:00:00Z`)) / 86_400_000) : null;

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="item">
        <p className="label">{draft ? 'Draft report' : `Issued ${audit.issuedOn ? fmtDate(audit.issuedOn) : ''}${days != null ? ` · ${days} day${days === 1 ? '' : 's'} after the audit` : ''}`}</p>
        {audit.onSchedule && <p className="caption">Issuing it marks its schedule done on What&rsquo;s due.</p>}
      </div>

      <label className="fieldcell"><span className="label">Scope</span>
        <input className="field field--sm" id="ad-scope" value={f.scope} disabled={ro} onChange={(e) => setF({ ...f, scope: e.target.value })} /></label>
      <label className="fieldcell"><span className="label">Criteria</span>
        <input className="field field--sm" id="ad-criteria" value={f.criteria} disabled={ro} onChange={(e) => setF({ ...f, criteria: e.target.value })} /></label>
      <label className="fieldcell"><span className="label">Auditor</span>
        <input className="field field--sm" id="ad-auditor" value={f.auditor} disabled={ro} onChange={(e) => setF({ ...f, auditor: e.target.value })} /></label>
      <label className={`checkrow${f.independent ? ' checkrow--on' : ''}`}>
        <input type="checkbox" id="ad-independent" checked={f.independent} disabled={ro} onChange={(e) => setF({ ...f, independent: e.target.checked })} />
        <span>The auditor does not deliver the work audited — objectivity and impartiality (ISO cl. 9.2.2). The report cannot be issued without this.</span>
      </label>
      <label className="fieldcell"><span className="label">The previous audit&rsquo;s actions, reviewed</span>
        <textarea className="field field--sm" id="ad-previous" rows={2} value={f.previousReview} disabled={ro} onChange={(e) => setF({ ...f, previousReview: e.target.value })} /></label>
      <label className="fieldcell"><span className="label">Summary of results</span>
        <textarea className="field field--sm" id="ad-summary" rows={3} value={f.summary} disabled={ro} placeholder="Overall conclusion, strengths, what needs work" onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>

      <p className="label" style={{ marginTop: '1rem' }}>Findings</p>
      {findings.length === 0 ? <p className="nil">No findings.</p> : (
        <div className="itp__points">
          {findings.map((x) => (
            <div key={x.id} className={`item${x.kind === 'major_nonconformity' ? ' itp__point--hold' : ''}`}>
              <p className="label">{x.seq}. {KIND_LABEL[x.kind] ?? x.kind}{x.clause ? ` · cl. ${x.clause}` : ''}</p>
              <p style={{ margin: '0.2rem 0 0' }}>{x.finding}</p>
              {x.action && (
                <p className={`caption${!x.done_at && x.due_on ? ' vr-missing' : ''}`}>
                  Action: {x.action}{x.owner_name ? ` · ${x.owner_name}` : ''}{x.due_on ? ` · due ${fmtDate(x.due_on)}` : ''}
                  {x.done_at ? ` · done ${fmtDate(perthDay(x.done_at))}${x.done_note ? ` — ${x.done_note}` : ''}` : ''}
                </p>
              )}
              {draft && canWrite && (
                <button type="button" className="linklike" disabled={busy !== null} onClick={() => void act(`del:${x.id}`, async () => {
                  const { error: e } = await createClient().from('audit_findings').delete().eq('id', x.id);
                  if (e) throw new Error(e.message);
                })}>Remove</button>
              )}
              {!draft && canWrite && x.action && !x.done_at && (
                <div className="signin__grid" style={{ alignItems: 'end' }}>
                  <label className="fieldcell"><span className="label">Done — how</span>
                    <input className="field field--sm" id={`fd-${x.id}`} value={doneNote[x.id] ?? ''} onChange={(e) => setDoneNote({ ...doneNote, [x.id]: e.target.value })} /></label>
                  <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act(`done:${x.id}`, async () => {
                    const { error: e } = await createClient().from('audit_findings').update({ done_at: new Date().toISOString(), done_note: (doneNote[x.id] ?? '').trim() || null }).eq('id', x.id);
                    if (e) throw new Error(e.message);
                  })}>Mark done</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {draft && canWrite && (
        <>
          <div className="item" style={{ marginTop: '0.75rem' }}>
            <p className="label">Add a finding</p>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Kind</span>
                <select className="field field--sm" id="nf-kind" value={nf.kind} onChange={(e) => setNf({ ...nf, kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select></label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Clause</span>
                <input className="field field--sm" id="nf-clause" value={nf.clause} placeholder="7.1.5" onChange={(e) => setNf({ ...nf, clause: e.target.value })} /></label>
            </div>
            <label className="fieldcell"><span className="label">Finding</span>
              <textarea className="field field--sm" id="nf-finding" rows={2} value={nf.finding} onChange={(e) => setNf({ ...nf, finding: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Action</span>
              <input className="field field--sm" id="nf-action" value={nf.action} onChange={(e) => setNf({ ...nf, action: e.target.value })} /></label>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Owner</span>
                <input className="field field--sm" id="nf-owner" value={nf.owner} onChange={(e) => setNf({ ...nf, owner: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Due</span>
                <input className="field field--sm" id="nf-due" type="date" value={nf.due} onChange={(e) => setNf({ ...nf, due: e.target.value })} /></label>
            </div>
            <button type="button" className="button button--quiet" disabled={busy !== null || !nf.finding.trim()} onClick={() => void act('finding', async () => {
              const seq = findings.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
              const { error: e } = await createClient().from('audit_findings').insert({ audit_id: audit.id, seq, kind: nf.kind, clause: nf.clause.trim() || null, finding: nf.finding.trim(), action: nf.action.trim() || null, owner_name: nf.owner.trim() || null, due_on: nf.due || null });
              if (e) throw new Error(e.message);
              setNf({ kind: 'minor_nonconformity', clause: '', finding: '', action: '', owner: '', due: '' });
            })}>Add the finding</button>
          </div>
          <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('save', async () => {
              const { error: e } = await createClient().from('audits').update(fields()).eq('id', audit.id);
              if (e) throw new Error(e.message);
            })}>{busy === 'save' ? 'Saving…' : 'Save the draft'}</button>
            <button type="button" className="button" disabled={busy !== null || !f.independent || !f.summary.trim()} onClick={() => void act('issue', async () => {
              const { error: e } = await createClient().from('audits').update({ ...fields(), status: 'issued' }).eq('id', audit.id);
              if (e) throw new Error(e.message);
            })}>{busy === 'issue' ? 'Issuing…' : 'Issue the report'}</button>
            <p className="caption">Once issued the report and its findings do not change; actions are marked done as they are.</p>
          </div>
        </>
      )}
    </>
  );
}
