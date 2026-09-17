'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { evaluationProblems, RESULT_LABEL, type ComplianceResult } from '@/lib/environment/model';

export interface EvalView { id: string; org_id: string; project_id: string | null; obligation_id: string | null; evaluated_on: string; evaluator_name: string; summary: string | null; status: 'draft' | 'issued'; issued_on: string | null }
export interface ObligationView { id: string; project_id: string | null; title: string; reference: string; requirement: string; how_applies: string; active: boolean }
export interface ResultView { id: string; legal_obligation_id: string; result: ComplianceResult; evidence: string | null; action: string | null; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null }

type Draft = { result: ComplianceResult | ''; evidence: string; action: string; owner: string; due: string };

export function EvaluationScreen({ evaluation: e, obligations, allObligations, results, canManage, today }: { evaluation: EvalView; obligations: ObligationView[]; allObligations: ObligationView[]; results: ResultView[]; canManage: boolean; today: string }) {
  const router = useRouter();
  const draft = e.status === 'draft';
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState(e.summary ?? '');
  const [forms, setForms] = useState<Record<string, Draft>>(() => Object.fromEntries(obligations.map((o) => {
    const r = results.find((x) => x.legal_obligation_id === o.id);
    return [o.id, { result: r?.result ?? '', evidence: r?.evidence ?? '', action: r?.action ?? '', owner: r?.owner_name ?? '', due: r?.due_on ?? '' }];
  })));
  const [doneNote, setDoneNote] = useState<Record<string, string>>({});

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }
  const must = (x: { message: string } | null) => { if (x) throw new Error(x.message); };

  const problems = evaluationProblems(allObligations, e.project_id, results, e.summary);

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="item" style={{ marginTop: '1rem' }}>
        <p className="label">{e.project_id ? 'This job' : 'Whole company'} · {fmtDate(e.evaluated_on)} · {e.evaluator_name}</p>
        <p className="caption">{draft ? 'Draft — results can still be changed.' : `Issued ${e.issued_on ? fmtDate(e.issued_on) : ''}. Frozen; only actions are marked done.`}</p>
      </div>

      {obligations.length === 0 && <p className="nil">The legal register has nothing in force for this evaluation.</p>}
      {obligations.map((o) => {
        const r = results.find((x) => x.legal_obligation_id === o.id);
        const f = forms[o.id];
        const set = (patch: Partial<Draft>) => setForms({ ...forms, [o.id]: { ...f, ...patch } });
        return (
          <div key={o.id} className={`item${r?.result === 'non_compliant' ? ' item--warn' : ''}`} style={{ marginTop: '0.75rem' }}>
            <p className="label">{o.reference}</p>
            <p style={{ margin: '0.2rem 0', fontWeight: 600 }}>{o.title}</p>
            <p className="caption">{o.requirement} <strong>Applies:</strong> {o.how_applies}</p>
            {draft && canManage ? (
              <div className="regpanel__form">
                <div className="signin__grid">
                  {(['compliant', 'non_compliant', 'not_applicable'] as ComplianceResult[]).map((res) => (
                    <label key={res} className={`checkrow checkrow--inline${f.result === res ? ' checkrow--on' : ''}`}>
                      <input type="radio" name={`res-${o.id}`} checked={f.result === res} onChange={() => set({ result: res })} /><span>{RESULT_LABEL[res]}</span>
                    </label>
                  ))}
                </div>
                {f.result !== 'not_applicable' && (
                  <label className="fieldcell"><span className="label">Evidence</span><input id={`ev-${o.id}`} className="field field--sm" placeholder="What was looked at: records, dockets, the site" value={f.evidence} onChange={(ev) => set({ evidence: ev.target.value })} /></label>
                )}
                {f.result === 'non_compliant' && (
                  <div className="signin__grid">
                    <label className="fieldcell"><span className="label">Action</span><input id={`act-${o.id}`} className="field field--sm" value={f.action} onChange={(ev) => set({ action: ev.target.value })} /></label>
                    <label className="fieldcell fieldcell--narrow"><span className="label">Who</span><input id={`own-${o.id}`} className="field field--sm" value={f.owner} onChange={(ev) => set({ owner: ev.target.value })} /></label>
                    <label className="fieldcell fieldcell--narrow"><span className="label">By</span><input id={`due-${o.id}`} className="field field--sm" type="date" value={f.due} onChange={(ev) => set({ due: ev.target.value })} /></label>
                  </div>
                )}
                <button type="button" className="button button--quiet" disabled={busy !== null || !f.result || (f.result !== 'not_applicable' && !f.evidence.trim()) || (f.result === 'non_compliant' && !f.action.trim())} onClick={() => void act(`res:${o.id}`, async () => {
                  const row = { result: f.result, evidence: f.result === 'not_applicable' ? null : f.evidence.trim(), action: f.result === 'non_compliant' ? f.action.trim() : null, owner_name: f.result === 'non_compliant' ? f.owner.trim() || null : null, due_on: f.result === 'non_compliant' ? f.due || null : null };
                  const supabase = createClient();
                  must((r ? await supabase.from('compliance_evaluation_results').update(row).eq('id', r.id) : await supabase.from('compliance_evaluation_results').insert({ ...row, evaluation_id: e.id, legal_obligation_id: o.id })).error);
                })}>{r ? 'Update result' : 'Save result'}</button>
                {r && <span className="caption"> Saved: {RESULT_LABEL[r.result]}</span>}
              </div>
            ) : r ? (
              <>
                <p className={`caption${r.result === 'non_compliant' ? ' vr-missing' : ''}`}><strong>{RESULT_LABEL[r.result]}</strong>{r.evidence ? ` · ${r.evidence}` : ''}</p>
                {r.action && (
                  <p className="caption">
                    Action: {r.action}{r.owner_name ? ` · ${r.owner_name}` : ''}{r.due_on ? <span className={!r.done_at && r.due_on < today ? 'vr-missing' : undefined}> · by {fmtDate(r.due_on)}</span> : ''}
                    {r.done_at ? ` · done ${fmtDate(r.done_at.slice(0, 10))}${r.done_note ? ` — ${r.done_note}` : ''}` : ''}
                  </p>
                )}
                {r.action && !r.done_at && canManage && !draft && (
                  <div className="signin__grid" style={{ alignItems: 'end' }}>
                    <label className="fieldcell"><span className="label">What was done</span><input id={`done-${r.id}`} className="field field--sm" value={doneNote[r.id] ?? ''} onChange={(ev) => setDoneNote({ ...doneNote, [r.id]: ev.target.value })} /></label>
                    <button type="button" className="button button--quiet" disabled={busy !== null || !(doneNote[r.id] ?? '').trim()} onClick={() => void act(`done:${r.id}`, async () => {
                      must((await createClient().from('compliance_evaluation_results').update({ done_at: new Date().toISOString(), done_note: doneNote[r.id].trim() }).eq('id', r.id)).error);
                    })}>Mark done</button>
                  </div>
                )}
              </>
            ) : <p className="caption vr-missing">No result recorded.</p>}
          </div>
        );
      })}

      {draft && canManage && (
        <div className="item" style={{ marginTop: '1rem' }}>
          <label className="fieldcell"><span className="label">Summary of compliance status</span>
            <textarea id="eval-summary" className="field field--sm" rows={3} value={summary} onChange={(ev) => setSummary(ev.target.value)} /></label>
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('summary', async () => {
            must((await createClient().from('compliance_evaluations').update({ summary: summary.trim() || null }).eq('id', e.id)).error);
          })}>Save summary</button>
          {problems.length > 0 ? (
            <p className="caption vr-missing">Before it can be issued: {problems.join('; ')}.</p>
          ) : <p className="caption">Ready to issue. Once issued it is frozen{e.obligation_id ? ' and its schedule is marked done' : ''}.</p>}
          <button type="button" className="button" disabled={busy !== null || problems.length > 0} onClick={() => void act('issue', async () => {
            must((await createClient().from('compliance_evaluations').update({ status: 'issued' }).eq('id', e.id)).error);
          })}>Issue the evaluation</button>
        </div>
      )}
      {!draft && e.summary && <div className="item" style={{ marginTop: '1rem' }}><p className="label">Summary</p><p className="caption">{e.summary}</p></div>}
    </>
  );
}
