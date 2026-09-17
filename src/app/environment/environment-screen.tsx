'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import {
  CONDITIONS, CONDITION_LABEL, SOURCE_TYPES, SOURCE_LABEL, MONITORING_KINDS, MONITORING_LABEL, OUTCOME_LABEL,
  significance, monitoringOutcome, type Condition, type SourceType, type MonitoringKind, type Outcome,
} from '@/lib/environment/model';

export interface JobSettings { env_report_hours_serious: number | null; env_report_hours_minor: number | null; env_investigation_days: number | null; env_rain_inspection_mm: number | string | null }
export interface Criteria { id: string; version: number; method: string; threshold: number; issued_at: string }
export interface AspectRow { id: string; activity: string; aspect: string; impact: string; condition: Condition; likelihood: number; consequence: number; score: number; significant: boolean; controls: string | null; active: boolean; reviewed_at: string; criteria_id: string | null; appliesHere: boolean | null; note: string | null }
export interface LegalRow { id: string; project_id: string | null; title: string; source_type: SourceType; reference: string; requirement: string; how_applies: string; active: boolean; reviewed_at: string; aspectIds: string[] }
export interface EvaluationRow { id: string; project_id: string | null; evaluated_on: string; evaluator_name: string; status: 'draft' | 'issued'; summary: string | null }
export interface MonitoringRow { id: string; monitored_on: string; kind: MonitoringKind; location: string; parameter: string; value: number | null; unit: string | null; limit_value: number | null; outcome: Outcome; action_taken: string | null; method: string | null; notes: string | null }

interface Props {
  orgId: string; projectId: string; today: string; canManage: boolean; canRecord: boolean; isAdmin: boolean;
  settings: JobSettings; criteria: Criteria | null; aspects: AspectRow[]; legal: LegalRow[]; evaluations: EvaluationRow[];
  monitoring: MonitoringRow[]; equipment: Array<{ id: string; name: string }>; schedules: Array<{ id: string; project_id: string | null; title: string }>;
  rainPrompts: Array<{ day: string; rainfallMm: number; dueOn: string }>;
}

const blankAspect = { id: null as string | null, activity: '', aspect: '', impact: '', condition: 'normal' as Condition, likelihood: 3, consequence: 3, controls: '', active: true };
const blankLegal = { id: null as string | null, scope: 'org' as 'org' | 'job', title: '', source_type: 'legislation' as SourceType, reference: '', requirement: '', how_applies: '', active: true, aspectIds: [] as string[] };
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function EnvironmentScreen(props: Props) {
  const { orgId, projectId, today, canManage, canRecord, isAdmin, settings, criteria, aspects, legal, evaluations, monitoring, equipment, schedules, rainPrompts } = props;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [crit, setCrit] = useState<{ open: boolean; method: string; threshold: string }>({ open: false, method: criteria?.method ?? 'Likelihood (1 rare to 5 almost certain) x consequence (1 negligible to 5 severe, long-lasting or off site). A score at or above the threshold is significant, as is anything a legal obligation applies to.', threshold: String(criteria?.threshold ?? 12) });
  const [asp, setAsp] = useState<typeof blankAspect | null>(null);
  const [leg, setLeg] = useState<typeof blankLegal | null>(null);
  const [evalForm, setEvalForm] = useState<{ open: boolean; scope: 'job' | 'org'; on: string; evaluator: string; schedule: string }>({ open: false, scope: 'job', on: today, evaluator: '', schedule: '' });
  const [mon, setMon] = useState({ open: false, on: today, kind: 'dust' as MonitoringKind, location: '', parameter: '', value: '', unit: '', limit: '', outcome: 'observation' as Outcome, action: '', method: '', equipment: '', notes: '' });
  const [job, setJob] = useState({ serious: settings.env_report_hours_serious?.toString() ?? '', minor: settings.env_report_hours_minor?.toString() ?? '', days: settings.env_investigation_days?.toString() ?? '', rain: settings.env_rain_inspection_mm?.toString() ?? '' });
  const [showAll, setShowAll] = useState(false);
  const pendingMon = usePending('env_monitoring', projectId, 'project').map((q) => q.payload.row as MonitoringRow);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key); setError(null); setNotice(null);
    // With no signal a refresh would blank the screen; what was saved on the phone is shown from the queue instead.
    try { const msg = await fn(); if (msg) setNotice(msg); if (navigator.onLine) router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(null); }
  }
  const must = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

  const applying = aspects.filter((a) => a.active && a.appliesHere === true);
  const significantHere = applying.filter((a) => a.significant);
  const monAuto = monitoringOutcome(numOrNull(mon.value), numOrNull(mon.limit), mon.outcome);
  const aspectName = (id: string) => aspects.find((a) => a.id === id)?.aspect ?? '—';

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <nav className="chips" aria-label="Sections" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0' }}>
        <a className="chip chip--link" href="#rain">After rain</a>
        <a className="chip chip--link" href="#aspects">Aspects</a>
        <a className="chip chip--link" href="#legal">Legal register</a>
        <a className="chip chip--link" href="#evaluations">Compliance</a>
        <a className="chip chip--link" href="#monitoring">Monitoring</a>
        <a className="chip chip--link" href="#job">Deadlines</a>
      </nav>

      <div className="claims-summary" aria-label="At a glance">
        <div className={`claims-tile${applying.length === 0 ? ' claims-tile--amber' : ''}`}>
          <span className="label">Aspects on this job</span>
          <strong>{applying.length}</strong>
          <span>{applying.length === 0 ? 'none identified yet' : `${significantHere.length} significant`}</span>
        </div>
        <div className="claims-tile">
          <span className="label">Legal register</span>
          <strong>{legal.filter((o) => o.active).length}</strong>
          <span>obligations in force</span>
        </div>
        <div className={`claims-tile${rainPrompts.length ? ' claims-tile--amber' : ''}`}>
          <span className="label">After-rain checks</span>
          <strong>{rainPrompts.length}</strong>
          <span>{rainPrompts.length ? 'waiting' : 'none waiting'}</span>
        </div>
      </div>

      {/* ------------------------------------------------------------ rain */}
      <section id="rain" style={{ marginTop: '1.5rem' }}>
        <p className="label">After heavy rain</p>
        {settings.env_rain_inspection_mm == null ? (
          <p className="caption">No rain trigger is set for this job.</p>
        ) : rainPrompts.length === 0 ? (
          <p className="caption">No day in the last fortnight had {Number(settings.env_rain_inspection_mm)} mm or more without an environmental check after it.</p>
        ) : (
          <ul className="gaplist">
            {rainPrompts.map((r) => (
              <li key={r.day} className="vr-missing">{r.rainfallMm} mm from 9 am on {fmtDate(r.day)} — environmental check due {fmtDate(r.dueOn)}</li>
            ))}
          </ul>
        )}
        {rainPrompts.length > 0 && <Link className="button button--quiet" href={`/inspections?project=${projectId}`}>Start an environmental check</Link>}
        <p className="caption">From the Bureau&rsquo;s rainfall for the job. It asks for a check; the check is the record.</p>
      </section>

      {/* ------------------------------------------------------------ aspects */}
      <hr className="rule" />
      <section id="aspects">
        <p className="label">Environmental aspects and impacts — ISO 14001 cl. 6.1.2</p>
        <div className="item" style={{ marginBottom: '0.75rem' }}>
          <p className="label">Significance criteria{criteria ? ` · version ${criteria.version}` : ''}</p>
          {criteria ? (
            <p className="caption">{criteria.method} Significant at a score of <strong>{criteria.threshold}</strong> or more. Set {fmtPerthDate(criteria.issued_at)}.</p>
          ) : (
            <p className="caption vr-missing">Not set. Aspects are judged against the criteria, so set them first.</p>
          )}
          {canManage && !crit.open && <button type="button" className="linklike" onClick={() => setCrit({ ...crit, open: true })}>{criteria ? 'Issue a new version' : 'Set the criteria'}</button>}
          {crit.open && (
            <div className="regpanel__form">
              <label className="fieldcell"><span className="label">How likelihood and consequence are judged</span>
                <textarea id="env-crit-method" className="field field--sm" rows={3} value={crit.method} onChange={(e) => setCrit({ ...crit, method: e.target.value })} /></label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Significant at score (1–25)</span>
                <input id="env-crit-threshold" className="field field--sm" inputMode="numeric" value={crit.threshold} onChange={(e) => setCrit({ ...crit, threshold: e.target.value })} /></label>
              <button type="button" className="button" disabled={busy !== null || !crit.method.trim() || !(Number(crit.threshold) >= 1 && Number(crit.threshold) <= 25)} onClick={() => void act('crit', async () => {
                must((await createClient().from('env_significance_criteria').insert({ org_id: orgId, version: 0, method: crit.method.trim(), threshold: Number(crit.threshold) })).error);
                setCrit({ ...crit, open: false });
                return 'Criteria issued. Each aspect is judged against them the next time it is reviewed.';
              })}>Issue</button>
              <button type="button" className="linklike" onClick={() => setCrit({ ...crit, open: false })}>Cancel</button>
              <p className="caption">Once issued a version cannot be changed; a change is a new version.</p>
            </div>
          )}
        </div>

        {aspects.length === 0 ? <p className="nil">No aspects recorded for the company yet.</p> : (
          <div className="claims-tablewrap">
            <table className="claims-table">
              <thead><tr><th>On this job</th><th>Activity</th><th>Aspect → impact</th><th className="n">Score</th><th>Controls</th>{canManage && <th />}</tr></thead>
              <tbody>
                {aspects.filter((a) => a.active || showAll).map((a) => (
                  <tr key={a.id}>
                    <td>
                      {canManage ? (
                        <select id={`env-applies-${a.id}`} className="field field--sm" style={{ minWidth: "9.5rem" }} value={a.appliesHere == null ? '' : a.appliesHere ? 'yes' : 'no'} disabled={busy !== null || !a.active} onChange={(e) => void act(`applies:${a.id}`, async () => {
                          must((await createClient().from('project_env_aspects').upsert({ project_id: projectId, aspect_id: a.id, applies: e.target.value === 'yes' }, { onConflict: 'project_id,aspect_id' })).error);
                        })}>
                          <option value="" disabled>Not decided</option>
                          <option value="yes">Applies</option>
                          <option value="no">Does not apply</option>
                        </select>
                      ) : a.appliesHere == null ? 'Not decided' : a.appliesHere ? 'Applies' : 'Does not apply'}
                    </td>
                    <td>{a.activity}<br /><span className="caption">{CONDITION_LABEL[a.condition]}{a.active ? '' : ' · retired'}</span></td>
                    <td>{a.aspect} → {a.impact}</td>
                    <td className="n mono">{a.likelihood}×{a.consequence} = {a.score}{a.significant ? <><br /><strong className="claims-flag">Significant</strong></> : null}{criteria && a.criteria_id !== criteria.id ? <><br /><span className="caption">review against v{criteria.version}</span></> : null}</td>
                    <td>{a.controls ?? '—'}</td>
                    {canManage && <td><button type="button" className="linklike" onClick={() => setAsp({ id: a.id, activity: a.activity, aspect: a.aspect, impact: a.impact, condition: a.condition, likelihood: a.likelihood, consequence: a.consequence, controls: a.controls ?? '', active: a.active })}>Review</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {aspects.some((a) => !a.active) && <button type="button" className="linklike" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide retired' : 'Show retired aspects'}</button>}
        {canManage && !asp && <button type="button" className="button button--quiet" style={{ marginTop: '0.5rem' }} disabled={!criteria} onClick={() => setAsp({ ...blankAspect })}>Add an aspect</button>}
        {asp && (
          <div className="item regpanel__form" style={{ marginTop: '0.75rem' }}>
            <p className="label">{asp.id ? 'Review aspect' : 'New aspect'}</p>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Activity</span><input id="env-asp-activity" className="field field--sm" placeholder="Bulk earthworks" value={asp.activity} onChange={(e) => setAsp({ ...asp, activity: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Condition</span>
                <select id="env-asp-condition" className="field field--sm" value={asp.condition} onChange={(e) => setAsp({ ...asp, condition: e.target.value as Condition })}>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                </select></label>
            </div>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Aspect (what the work does)</span><input id="env-asp-aspect" className="field field--sm" placeholder="Dust from haul roads" value={asp.aspect} onChange={(e) => setAsp({ ...asp, aspect: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Impact (what it does to the environment)</span><input id="env-asp-impact" className="field field--sm" placeholder="Nuisance to neighbours, air quality" value={asp.impact} onChange={(e) => setAsp({ ...asp, impact: e.target.value })} /></label>
            </div>
            <div className="signin__grid">
              <label className="fieldcell fieldcell--narrow"><span className="label">Likelihood 1–5</span><input id="env-asp-l" className="field field--sm" type="number" min={1} max={5} value={asp.likelihood} onChange={(e) => setAsp({ ...asp, likelihood: Number(e.target.value) })} /></label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Consequence 1–5</span><input id="env-asp-c" className="field field--sm" type="number" min={1} max={5} value={asp.consequence} onChange={(e) => setAsp({ ...asp, consequence: Number(e.target.value) })} /></label>
              <p className="caption" style={{ alignSelf: 'end' }}>Score {asp.likelihood * asp.consequence}{criteria ? ` — ${significance(asp.likelihood, asp.consequence, criteria.threshold).significant ? 'significant' : 'not significant'} under v${criteria.version}` : ''}</p>
            </div>
            <label className="fieldcell"><span className="label">Controls in place</span><input id="env-asp-controls" className="field field--sm" placeholder="Water cart twice a day, 20 km/h on haul roads" value={asp.controls} onChange={(e) => setAsp({ ...asp, controls: e.target.value })} /></label>
            {asp.id && <label className="checkrow checkrow--inline"><input type="checkbox" checked={!asp.active} onChange={(e) => setAsp({ ...asp, active: !e.target.checked })} /><span>Retire it — no longer part of what the company does</span></label>}
            <button type="button" className="button" disabled={busy !== null || !asp.activity.trim() || !asp.aspect.trim() || !asp.impact.trim() || !(asp.likelihood >= 1 && asp.likelihood <= 5 && asp.consequence >= 1 && asp.consequence <= 5)} onClick={() => void act('aspect', async () => {
              const row = { activity: asp.activity, aspect: asp.aspect, impact: asp.impact, condition: asp.condition, likelihood: asp.likelihood, consequence: asp.consequence, controls: asp.controls, active: asp.active };
              const supabase = createClient();
              must((asp.id ? await supabase.from('env_aspects').update(row).eq('id', asp.id) : await supabase.from('env_aspects').insert({ ...row, org_id: orgId })).error);
              setAsp(null);
              return asp.id ? 'Reviewed. The version before is kept.' : 'Aspect added. Say on the list whether it applies to this job.';
            })}>Save</button>
            <button type="button" className="linklike" onClick={() => setAsp(null)}>Cancel</button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ legal */}
      <hr className="rule" />
      <section id="legal">
        <p className="label">Legal register — ISO 14001 cl. 6.1.3</p>
        {legal.length === 0 ? <p className="nil">No compliance obligations recorded yet.</p> : (
          <div className="itp__points">
            {legal.filter((o) => o.active || showAll).map((o) => (
              <div key={o.id} className="item">
                <p className="label">{o.reference} · {SOURCE_LABEL[o.source_type]}{o.project_id ? ' · this job' : ' · company-wide'}{o.active ? '' : ' · no longer in force'}</p>
                <p style={{ margin: '0.2rem 0', fontWeight: 600 }}>{o.title}</p>
                <p className="caption">{o.requirement}</p>
                <p className="caption"><strong>How it applies:</strong> {o.how_applies}</p>
                {o.aspectIds.length > 0 && <p className="caption">Aspects: {o.aspectIds.map(aspectName).join(', ')}</p>}
                {canManage && <button type="button" className="linklike" onClick={() => setLeg({ id: o.id, scope: o.project_id ? 'job' : 'org', title: o.title, source_type: o.source_type, reference: o.reference, requirement: o.requirement, how_applies: o.how_applies, active: o.active, aspectIds: o.aspectIds })}>Review</button>}
              </div>
            ))}
          </div>
        )}
        {canManage && !leg && <button type="button" className="button button--quiet" style={{ marginTop: '0.5rem' }} onClick={() => setLeg({ ...blankLegal })}>Add an obligation</button>}
        {leg && (
          <div className="item regpanel__form" style={{ marginTop: '0.75rem' }}>
            <p className="label">{leg.id ? 'Review obligation' : 'New obligation'}</p>
            {!leg.id && (
              <label className="fieldcell"><span className="label">Applies to</span>
                <select id="env-leg-scope" className="field field--sm" value={leg.scope} onChange={(e) => setLeg({ ...leg, scope: e.target.value as 'org' | 'job' })}>
                  <option value="org">Every job — an Act, regulations, a company licence</option>
                  <option value="job">This job only — its contract, its approvals</option>
                </select></label>
            )}
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Source</span>
                <select id="env-leg-source" className="field field--sm" value={leg.source_type} onChange={(e) => setLeg({ ...leg, source_type: e.target.value as SourceType })}>
                  {SOURCE_TYPES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                </select></label>
              <label className="fieldcell"><span className="label">Reference</span><input id="env-leg-ref" className="field field--sm" placeholder="EP Act 1986 (WA) s. 72" value={leg.reference} onChange={(e) => setLeg({ ...leg, reference: e.target.value })} /></label>
            </div>
            <label className="fieldcell"><span className="label">Title</span><input id="env-leg-title" className="field field--sm" placeholder="Duty to notify of a discharge" value={leg.title} onChange={(e) => setLeg({ ...leg, title: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">What it requires</span><textarea id="env-leg-req" className="field field--sm" rows={2} value={leg.requirement} onChange={(e) => setLeg({ ...leg, requirement: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">How it applies to our work</span><textarea id="env-leg-how" className="field field--sm" rows={2} placeholder="Any fuel, oil or sediment reaching drains from our plant or excavations" value={leg.how_applies} onChange={(e) => setLeg({ ...leg, how_applies: e.target.value })} /></label>
            {aspects.some((a) => a.active) && (
              <fieldset className="fieldcell"><legend className="label">Aspects it relates to</legend>
                {aspects.filter((a) => a.active).map((a) => (
                  <label key={a.id} className="checkrow checkrow--inline"><input type="checkbox" checked={leg.aspectIds.includes(a.id)} onChange={(e) => setLeg({ ...leg, aspectIds: e.target.checked ? [...leg.aspectIds, a.id] : leg.aspectIds.filter((x) => x !== a.id) })} /><span>{a.aspect}</span></label>
                ))}
              </fieldset>
            )}
            {leg.id && <label className="checkrow checkrow--inline"><input type="checkbox" checked={!leg.active} onChange={(e) => setLeg({ ...leg, active: !e.target.checked })} /><span>No longer in force</span></label>}
            <button type="button" className="button" disabled={busy !== null || !leg.title.trim() || !leg.reference.trim() || !leg.requirement.trim() || !leg.how_applies.trim()} onClick={() => void act('legal', async () => {
              const supabase = createClient();
              const row = { title: leg.title, source_type: leg.source_type, reference: leg.reference, requirement: leg.requirement.trim(), how_applies: leg.how_applies.trim(), active: leg.active };
              let id = leg.id;
              if (id) must((await supabase.from('env_legal_obligations').update(row).eq('id', id)).error);
              else {
                const { data, error: e } = await supabase.from('env_legal_obligations').insert({ ...row, org_id: orgId, project_id: leg.scope === 'job' ? projectId : null }).select('id').single();
                must(e); id = (data as { id: string }).id;
              }
              const before = legal.find((o) => o.id === id)?.aspectIds ?? [];
              const add = leg.aspectIds.filter((a) => !before.includes(a));
              const drop = before.filter((a) => !leg.aspectIds.includes(a));
              if (add.length) must((await supabase.from('env_obligation_aspects').insert(add.map((aspect_id) => ({ obligation_id: id, aspect_id })))).error);
              for (const aspect_id of drop) must((await supabase.from('env_obligation_aspects').delete().eq('obligation_id', id!).eq('aspect_id', aspect_id)).error);
              setLeg(null);
              return leg.id ? 'Reviewed. The version before is kept.' : 'Obligation added to the register.';
            })}>Save</button>
            <button type="button" className="linklike" onClick={() => setLeg(null)}>Cancel</button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ evaluations */}
      <hr className="rule" />
      <section id="evaluations">
        <p className="label">Evaluations of compliance — ISO 14001 cl. 9.1.2</p>
        {evaluations.length === 0 ? <p className="nil">None yet.</p> : (
          <ul className="gaplist">
            {evaluations.map((e) => (
              <li key={e.id}>
                <Link className="claims-cite" href={`/environment/evaluation/${e.id}?project=${projectId}`}>{fmtDate(e.evaluated_on)} · {e.project_id ? 'this job' : 'whole company'}</Link>
                {' · '}{e.evaluator_name} · {e.status === 'issued' ? 'issued' : <span className="claims-flag">draft</span>}{e.summary ? ` · ${e.summary}` : ''}
              </li>
            ))}
          </ul>
        )}
        {canManage && !evalForm.open && <button type="button" className="button button--quiet" disabled={legal.filter((o) => o.active).length === 0} onClick={() => setEvalForm({ ...evalForm, open: true })}>Start an evaluation</button>}
        {evalForm.open && (
          <div className="item regpanel__form" style={{ marginTop: '0.75rem' }}>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Covers</span>
                <select id="env-eval-scope" className="field field--sm" value={evalForm.scope} onChange={(e) => setEvalForm({ ...evalForm, scope: e.target.value as 'job' | 'org', schedule: '' })}>
                  <option value="job">This job</option><option value="org">The whole company</option>
                </select></label>
              <label className="fieldcell"><span className="label">Evaluated on</span><input id="env-eval-on" className="field field--sm" type="date" max={today} value={evalForm.on} onChange={(e) => setEvalForm({ ...evalForm, on: e.target.value })} /></label>
            </div>
            <label className="fieldcell"><span className="label">Evaluated by</span><input id="env-eval-by" className="field field--sm" value={evalForm.evaluator} onChange={(e) => setEvalForm({ ...evalForm, evaluator: e.target.value })} /></label>
            {schedules.filter((s) => (evalForm.scope === 'job' ? s.project_id === projectId : s.project_id == null)).length > 0 && (
              <label className="fieldcell"><span className="label">Discharges the schedule</span>
                <select id="env-eval-schedule" className="field field--sm" value={evalForm.schedule} onChange={(e) => setEvalForm({ ...evalForm, schedule: e.target.value })}>
                  <option value="">None</option>
                  {schedules.filter((s) => (evalForm.scope === 'job' ? s.project_id === projectId : s.project_id == null)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select></label>
            )}
            <button type="button" className="button" disabled={busy !== null || !evalForm.evaluator.trim()} onClick={() => void act('eval', async () => {
              const { data, error: e } = await createClient().from('compliance_evaluations').insert({ org_id: orgId, project_id: evalForm.scope === 'job' ? projectId : null, obligation_id: evalForm.schedule || null, evaluated_on: evalForm.on, evaluator_name: evalForm.evaluator.trim() }).select('id').single();
              must(e);
              router.push(`/environment/evaluation/${(data as { id: string }).id}?project=${projectId}`);
            })}>Start</button>
            <button type="button" className="linklike" onClick={() => setEvalForm({ ...evalForm, open: false })}>Cancel</button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ monitoring */}
      <hr className="rule" />
      <section id="monitoring">
        <p className="label">Monitoring — ISO 14001 cl. 9.1.1</p>
        {pendingMon.length > 0 && (
          <ul className="gaplist">
            {pendingMon.map((m) => <li key={m.id} className="caption"><strong>On this phone, not yet sent:</strong> {fmtDate(m.monitored_on)} · {MONITORING_LABEL[m.kind]} · {m.parameter} · {m.location}{m.value != null ? ` · ${m.value} ${m.unit ?? ''}` : ''} · {OUTCOME_LABEL[m.outcome]}</li>)}
          </ul>
        )}
        {monitoring.length === 0 && pendingMon.length === 0 ? <p className="nil">Nothing recorded on this job yet.</p> : monitoring.length === 0 ? null : (
          <div className="claims-tablewrap">
            <table className="claims-table">
              <thead><tr><th>Date</th><th>What</th><th>Where</th><th className="n">Reading</th><th>Outcome</th></tr></thead>
              <tbody>
                {monitoring.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{fmtDate(m.monitored_on)}</td>
                    <td>{MONITORING_LABEL[m.kind]} · {m.parameter}{m.method ? <><br /><span className="caption">{m.method}</span></> : null}</td>
                    <td>{m.location}</td>
                    <td className="n mono">{m.value == null ? '—' : `${m.value} ${m.unit ?? ''}`}{m.limit_value != null ? <><br /><span className="caption">limit {m.limit_value}</span></> : null}</td>
                    <td className={m.outcome === 'exceedance' ? 'claims-flag' : undefined}>{OUTCOME_LABEL[m.outcome]}{m.action_taken ? <><br /><span className="caption">{m.action_taken}</span></> : null}{m.notes ? <><br /><span className="caption">{m.notes}</span></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canRecord && !mon.open && <button type="button" className="button button--quiet" style={{ marginTop: '0.5rem' }} onClick={() => setMon({ ...mon, open: true })}>Record monitoring</button>}
        {mon.open && (
          <div className="item regpanel__form" style={{ marginTop: '0.75rem' }}>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Date</span><input id="env-mon-on" className="field field--sm" type="date" max={today} value={mon.on} onChange={(e) => setMon({ ...mon, on: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">What</span>
                <select id="env-mon-kind" className="field field--sm" value={mon.kind} onChange={(e) => setMon({ ...mon, kind: e.target.value as MonitoringKind })}>
                  {MONITORING_KINDS.map((k) => <option key={k} value={k}>{MONITORING_LABEL[k]}</option>)}
                </select></label>
            </div>
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Where</span><input id="env-mon-loc" className="field field--sm" placeholder="Eastern boundary" value={mon.location} onChange={(e) => setMon({ ...mon, location: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">Measure</span><input id="env-mon-param" className="field field--sm" placeholder="LAeq 15 min, turbidity, visible dust" value={mon.parameter} onChange={(e) => setMon({ ...mon, parameter: e.target.value })} /></label>
            </div>
            <div className="signin__grid">
              <label className="fieldcell fieldcell--narrow"><span className="label">Reading</span><input id="env-mon-value" className="field field--sm" inputMode="decimal" value={mon.value} onChange={(e) => setMon({ ...mon, value: e.target.value })} /></label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Unit</span><input id="env-mon-unit" className="field field--sm" placeholder="dB(A)" value={mon.unit} onChange={(e) => setMon({ ...mon, unit: e.target.value })} /></label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Limit</span><input id="env-mon-limit" className="field field--sm" inputMode="decimal" value={mon.limit} onChange={(e) => setMon({ ...mon, limit: e.target.value })} /></label>
            </div>
            {numOrNull(mon.value) == null || numOrNull(mon.limit) == null ? (
              <label className="fieldcell"><span className="label">Outcome</span>
                <select id="env-mon-outcome" className="field field--sm" value={mon.outcome} onChange={(e) => setMon({ ...mon, outcome: e.target.value as Outcome })}>
                  {(['observation', 'within_limit', 'exceedance'] as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                </select></label>
            ) : <p className={`caption${monAuto === 'exceedance' ? ' vr-missing' : ''}`}>{OUTCOME_LABEL[monAuto]} — judged from the reading and its limit.</p>}
            {monAuto === 'exceedance' && (
              <label className="fieldcell"><span className="label">What was done about it</span><input id="env-mon-action" className="field field--sm" value={mon.action} onChange={(e) => setMon({ ...mon, action: e.target.value })} /></label>
            )}
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Method</span><input id="env-mon-method" className="field field--sm" placeholder="Class 1 meter, 15 min" value={mon.method} onChange={(e) => setMon({ ...mon, method: e.target.value })} /></label>
              {equipment.length > 0 && (
                <label className="fieldcell"><span className="label">Instrument</span>
                  <select id="env-mon-equipment" className="field field--sm" value={mon.equipment} onChange={(e) => setMon({ ...mon, equipment: e.target.value })}>
                    <option value="">None</option>{equipment.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select></label>
              )}
            </div>
            <label className="fieldcell"><span className="label">Notes</span><input id="env-mon-notes" className="field field--sm" value={mon.notes} onChange={(e) => setMon({ ...mon, notes: e.target.value })} /></label>
            <button type="button" className="button" disabled={busy !== null || !mon.location.trim() || !mon.parameter.trim() || (numOrNull(mon.value) != null && !mon.unit.trim()) || (monAuto === 'exceedance' && !mon.action.trim())} onClick={() => void act('mon', async () => {
              const row = {
                id: outbox.newId(), project_id: projectId, monitored_on: mon.on, kind: mon.kind, location: mon.location.trim(), parameter: mon.parameter.trim(),
                value: numOrNull(mon.value), unit: mon.unit.trim() || null, limit_value: numOrNull(mon.limit), outcome: monAuto,
                action_taken: mon.action.trim() || null, method: mon.method.trim() || null, equipment_id: mon.equipment || null, notes: mon.notes.trim() || null,
              };
              const live = async () => { must((await createClient().from('env_monitoring_records').insert(row)).error); };
              const queue = () => outbox.enqueue({ kind: 'env_monitoring', projectId, subjectId: row.id, payload: { row } }).then(() => undefined);
              const outcome = await runOrQueue(live, queue);
              setMon({ ...mon, open: false, location: '', parameter: '', value: '', unit: '', limit: '', action: '', notes: '' });
              return outcome === 'sent' ? 'Recorded.' : 'No signal — saved on this phone. It sends when you are back in range.';
            })}>Record it</button>
            <button type="button" className="linklike" onClick={() => setMon({ ...mon, open: false })}>Cancel</button>
            <p className="caption">Once recorded it cannot be changed.</p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ job settings */}
      <hr className="rule" />
      <section id="job">
        <p className="label">Environmental incident deadlines on this job</p>
        <p className="caption">
          As a subcontractor these come from the head contractor &mdash; their environmental management plan or the subcontract.
          Where the head contract is a Main Roads WA job, Spec 204 cl. 204.28 flows down: 24 hours for moderate, major or
          catastrophic, 3 days for insignificant or minor, 28 days for a Serious incident&rsquo;s investigation. Blank means none
          is set. {!isAdmin && 'An admin sets these.'}
        </p>
        <div className="signin__grid" style={{ alignItems: 'end' }}>
          <label className="fieldcell fieldcell--narrow"><span className="label">Moderate or worse (hours)</span><input id="env-job-serious" className="field field--sm" inputMode="numeric" disabled={!isAdmin} value={job.serious} onChange={(e) => setJob({ ...job, serious: e.target.value })} /></label>
          <label className="fieldcell fieldcell--narrow"><span className="label">Minor or less (hours)</span><input id="env-job-minor" className="field field--sm" inputMode="numeric" disabled={!isAdmin} value={job.minor} onChange={(e) => setJob({ ...job, minor: e.target.value })} /></label>
          <label className="fieldcell fieldcell--narrow"><span className="label">Investigation (days)</span><input id="env-job-days" className="field field--sm" inputMode="numeric" disabled={!isAdmin} value={job.days} onChange={(e) => setJob({ ...job, days: e.target.value })} /></label>
          <label className="fieldcell fieldcell--narrow"><span className="label">Check after rain of (mm)</span><input id="env-job-rain" className="field field--sm" inputMode="decimal" disabled={!isAdmin} value={job.rain} onChange={(e) => setJob({ ...job, rain: e.target.value })} /></label>
        </div>
        {isAdmin && (
          <>
            <button type="button" className="button button--quiet" style={{ marginTop: '0.5rem' }} disabled={busy !== null} onClick={() => void act('job', async () => {
              must((await createClient().from('projects').update({ env_report_hours_serious: numOrNull(job.serious), env_report_hours_minor: numOrNull(job.minor), env_investigation_days: numOrNull(job.days), env_rain_inspection_mm: numOrNull(job.rain) }).eq('id', projectId)).error);
              return 'Saved.';
            })}>Save the clocks</button>
            <button type="button" className="linklike" disabled={busy !== null} onClick={() => setJob({ serious: '24', minor: '72', days: '28', rain: job.rain || '10' })}>Fill in Main Roads Spec 204&rsquo;s</button>
          </>
        )}
      </section>
    </>
  );
}
