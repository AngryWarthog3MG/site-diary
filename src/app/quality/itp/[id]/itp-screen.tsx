'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { POINT_TYPES, POINT_TYPE_LABEL, pointProblems, itpRef, type PointType } from '@/lib/quality/model';

interface Itp {
  id: string; projectId: string; code: string; title: string; specReference: string | null; revision: number;
  status: 'draft' | 'issued' | 'superseded'; submittedOn: string | null; reviewNote: string | null; issuedAt: string | null;
}
interface Point {
  id: string; seq: number; activity: string; inspection_test: string; acceptance_criteria: string; method: string | null;
  frequency: string; responsible: string; reviewer: string | null; point_type: PointType; uses_calibrated_equipment: boolean; record_required: string | null;
}

const perthDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * An ITP. As a draft its points are written and removed; issuing freezes it.
 * An issued ITP takes only the principal's review, and is changed by revising
 * it — a new draft carrying its points, which supersedes it when issued.
 */
export function ItpScreen({ itp, points, newer, canManage }: { itp: Itp; points: Point[]; newer: { id: string; revision: number; status: string } | null; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const blank = { activity: '', inspection_test: '', acceptance_criteria: '', method: '', frequency: '', responsible: '', reviewer: '', point_type: '' as PointType | '', uses_calibrated_equipment: false, record_required: '' };
  const [p, setP] = useState(blank);
  const [submittedOn, setSubmittedOn] = useState(itp.submittedOn ?? '');
  const [reviewNote, setReviewNote] = useState(itp.reviewNote ?? '');
  const draft = itp.status === 'draft';
  const problems = pointProblems(p);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }

  const addPoint = () => act('add', async () => {
    const seq = points.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
    const { error: e } = await createClient().from('itp_points').insert({
      itp_id: itp.id, seq, activity: p.activity.trim(), inspection_test: p.inspection_test.trim(), acceptance_criteria: p.acceptance_criteria.trim(),
      method: p.method.trim() || null, frequency: p.frequency.trim(), responsible: p.responsible.trim(), reviewer: p.reviewer.trim() || null,
      point_type: p.point_type, uses_calibrated_equipment: p.uses_calibrated_equipment, record_required: p.record_required.trim() || null,
    });
    if (e) throw new Error(e.message);
    setP(blank);
    setAdding(false);
  });

  const revise = () => act('revise', async () => {
    const supabase = createClient();
    const { data, error: e } = await supabase.from('itps').insert({ project_id: itp.projectId, code: itp.code, title: itp.title, spec_reference: itp.specReference, supersedes_id: itp.id, revision: 0 }).select('id').single();
    if (e) throw new Error(e.message);
    if (points.length > 0) {
      const { error: pe } = await supabase.from('itp_points').insert(points.map((x) => ({
        itp_id: data.id, seq: x.seq, activity: x.activity, inspection_test: x.inspection_test, acceptance_criteria: x.acceptance_criteria,
        method: x.method, frequency: x.frequency, responsible: x.responsible, reviewer: x.reviewer, point_type: x.point_type,
        uses_calibrated_equipment: x.uses_calibrated_equipment, record_required: x.record_required,
      })));
      if (pe) throw new Error(`The revision was started but its points did not copy: ${pe.message}`);
    }
    router.push(`/quality/itp/${data.id}?project=${itp.projectId}`);
  });

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="item">
        <p className="label">{draft ? 'Draft — not yet issued' : itp.status === 'issued' ? `Issued ${itp.issuedAt ? fmtDate(perthDay(itp.issuedAt)) : ''}` : 'Superseded'}</p>
        {newer && <p className="caption">Revised: <Link href={`/quality/itp/${newer.id}?project=${itp.projectId}`}>{itpRef(itp.code, newer.revision)}</Link> ({newer.status})</p>}
        {itp.submittedOn && <p className="caption">Given to the principal for review {fmtDate(itp.submittedOn)}{itp.reviewNote ? ` · ${itp.reviewNote}` : ''}</p>}
      </div>

      <p className="label" style={{ marginTop: '1rem' }}>Inspection and test points</p>
      {points.length === 0 ? <p className="nil">No points yet.</p> : (
        <div className="itp__points">
          {points.map((x) => (
            <div key={x.id} className={`item itp__point${x.point_type === 'hold' ? ' itp__point--hold' : ''}`}>
              <p className="label">{x.seq}. {x.activity} · {POINT_TYPE_LABEL[x.point_type]}{x.uses_calibrated_equipment ? ' · calibrated equipment' : ''}</p>
              <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>{x.inspection_test}</p>
              <p className="caption">Accept: {x.acceptance_criteria}</p>
              <p className="caption">{[x.method && `Method: ${x.method}`, `How often: ${x.frequency}`, `By: ${x.responsible}`, x.reviewer && `Reviewed by: ${x.reviewer}`, x.record_required && `Record: ${x.record_required}`].filter(Boolean).join(' · ')}</p>
              {draft && canManage && (
                <button type="button" className="linklike" disabled={busy !== null} onClick={() => void act(`del:${x.id}`, async () => {
                  const { error: e } = await createClient().from('itp_points').delete().eq('id', x.id);
                  if (e) throw new Error(e.message);
                })}>Remove</button>
              )}
            </div>
          ))}
        </div>
      )}

      {draft && canManage && (
        !adding ? (
          <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setAdding(true)}>Add a point</button>
        ) : (
          <div className="item" style={{ marginTop: '0.75rem' }}>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Work process</span>
                <input className="field field--sm" id="pt-activity" value={p.activity} placeholder="Subgrade preparation" onChange={(e) => setP({ ...p, activity: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Kind of point</span>
                <select className="field field--sm" id="pt-type" value={p.point_type} onChange={(e) => setP({ ...p, point_type: e.target.value as PointType | '' })}>
                  <option value="">Choose…</option>
                  {POINT_TYPES.map((t) => <option key={t} value={t}>{POINT_TYPE_LABEL[t]}</option>)}
                </select></label>
            </div>
            <label className="fieldcell"><span className="label">What is inspected or tested</span>
              <input className="field field--sm" id="pt-test" value={p.inspection_test} placeholder="Compaction" onChange={(e) => setP({ ...p, inspection_test: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Acceptance criteria</span>
              <input className="field field--sm" id="pt-criteria" value={p.acceptance_criteria} placeholder="≥ 98% MDD (modified)" onChange={(e) => setP({ ...p, acceptance_criteria: e.target.value })} /></label>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Method</span>
                <input className="field field--sm" id="pt-method" value={p.method} placeholder="AS 1289.5.8.1 nuclear gauge" onChange={(e) => setP({ ...p, method: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">How often</span>
                <input className="field field--sm" id="pt-freq" value={p.frequency} placeholder="1 test per 500 m² per layer" onChange={(e) => setP({ ...p, frequency: e.target.value })} /></label>
            </div>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Who does it</span>
                <input className="field field--sm" id="pt-resp" value={p.responsible} placeholder="Leading hand" onChange={(e) => setP({ ...p, responsible: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Who reviews the result</span>
                <input className="field field--sm" id="pt-reviewer" value={p.reviewer} placeholder="Supervisor" onChange={(e) => setP({ ...p, reviewer: e.target.value })} /></label>
            </div>
            <label className="fieldcell"><span className="label">The record it produces</span>
              <input className="field field--sm" id="pt-record" value={p.record_required} placeholder="NATA test report" onChange={(e) => setP({ ...p, record_required: e.target.value })} /></label>
            <label className={`checkrow${p.uses_calibrated_equipment ? ' checkrow--on' : ''}`}>
              <input type="checkbox" id="pt-cal" checked={p.uses_calibrated_equipment} onChange={(e) => setP({ ...p, uses_calibrated_equipment: e.target.checked })} />
              <span>This measurement uses calibrated equipment — every check will name it, and it must be in calibration that day</span>
            </label>
            {problems.length > 0 && <p className="caption">Still needs: {problems.join(', ')}.</p>}
            <button type="button" className="button" disabled={busy !== null || problems.length > 0} onClick={() => void addPoint()}>{busy === 'add' ? 'Adding…' : 'Add the point'}</button>
            <button type="button" className="linklike" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        )
      )}

      {canManage && draft && (
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
          <button type="button" className="button" disabled={busy !== null || points.length === 0} onClick={() => void act('issue', async () => {
            const { error: e } = await createClient().from('itps').update({ status: 'issued' }).eq('id', itp.id);
            if (e) throw new Error(e.message);
          })}>{busy === 'issue' ? 'Issuing…' : `Issue ${itpRef(itp.code, itp.revision)}`}</button>
          <p className="caption">Once issued its points do not change. Lots can then be opened against it.</p>
          <button type="button" className="linklike" disabled={busy !== null} onClick={() => void act('delete', async () => {
            const { error: e } = await createClient().from('itps').delete().eq('id', itp.id);
            if (e) throw new Error(e.message);
            router.push(`/quality?project=${itp.projectId}`);
          })}>Delete this draft</button>
        </div>
      )}

      {canManage && itp.status === 'issued' && (
        <div className="item" style={{ marginTop: '1rem' }}>
          <p className="label">The principal&rsquo;s review</p>
          <p className="caption">Main Roads WA Spec 201: an ITP is made available to the Superintendent for review before it is used.</p>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Given for review on</span>
              <input className="field field--sm" id="itp-submitted" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Their comments</span>
              <input className="field field--sm" id="itp-review" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /></label>
          </div>
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('review', async () => {
            const { error: e } = await createClient().from('itps').update({ submitted_to_principal_on: submittedOn || null, principal_review_note: reviewNote.trim() || null }).eq('id', itp.id);
            if (e) throw new Error(e.message);
          })}>Save the review</button>
          {!newer && (
            <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void revise()}>
              {busy === 'revise' ? 'Starting…' : `Revise — start ${itpRef(itp.code, itp.revision + 1)}`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
