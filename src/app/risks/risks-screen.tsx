'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  CONSEQUENCE, CONSEQUENCE_LABEL, DEFAULT_MATRIX, LIKELIHOOD, LIKELIHOOD_LABEL, PROFILE_STATUS_LABEL, RISK_LABEL, RISK_LEVELS, SCOPE_LABEL,
  gaugeLevel, summariseRisks, type LevelCounts, type Matrix, type ProfileScope, type RiskLevel, type RiskSummary,
} from '@/lib/risks/model';
import type { RiskRegisterData } from '@/lib/risks/load';
import { fmtDay } from '@/lib/registers/model';
import { Fold } from '@/components/fold';
import { Field, Messages, PickBox, PrintBar, blankToNull, readMonths, usePick, useSave } from '../registers/shared';

interface Props {
  orgId: string; projectId: string; jobCode: string; userId: string; today: string;
  data: RiskRegisterData;
  assets: Array<{ id: string; name: string; asset_no: string | null }>;
  canAssessJob: boolean; isOffice: boolean;
}

const LEVEL_COLOUR: Record<RiskLevel, string> = { low: '#2e6b4f', medium: '#8a5a00', high: '#b4541a', extreme: '#9a2f2f' };

/**
 * The register on screen (README R187): the gauges over every open risk in view, the profiles with
 * their review dates, one way to start a profile, and — for the office — the company's matrix.
 */
export function RisksScreen({ orgId, projectId, jobCode, today, data, assets, canAssessJob, isOffice }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const live = useMemo(() => data.verdicts.filter((v) => v.profile.status !== 'archived'), [data.verdicts]);
  const shown = showArchived ? data.verdicts : live;
  const liveIds = useMemo(() => new Set(live.map((v) => v.profile.id)), [live]);
  const summary = useMemo(() => summariseRisks(data.risks.filter((r) => liveIds.has(r.profile_id)), data.controls, today), [data.risks, data.controls, liveIds, today]);
  const all = useMemo(() => live.map((v) => v.profile.id), [live]);
  const onJob = useMemo(() => live.filter((v) => v.profile.scope !== 'project' || v.profile.project_id === projectId).map((v) => v.profile.id), [live, projectId]);
  const pick = usePick(all);
  const q = `?project=${projectId}`;
  const archived = data.verdicts.length - live.length;

  return (
    <div className="regs">
      <Gauges summary={summary} />

      <PrintBar pdf="/api/risks/pdf" projectId={projectId} pick={pick} all={all} onJob={onJob} jobCode={jobCode} />

      {(canAssessJob || isOffice) && (adding
        ? <AddProfile orgId={orgId} projectId={projectId} jobCode={jobCode} assets={assets} canAssessJob={canAssessJob} isOffice={isOffice} onDone={() => setAdding(false)} />
        : <button type="button" className="button" style={{ marginTop: '1rem' }} onClick={() => setAdding(true)}>Start a profile</button>)}

      {archived > 0 && (
        <label className="regs__tick" style={{ marginTop: '0.75rem' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show the {archived} archived
        </label>
      )}

      <div className="regs__list" style={{ marginTop: '1rem' }}>
        {shown.length === 0 && <p className="caption">No risk profiles yet. Start one for this job, and bring its SWMS steps in.</p>}
        {shown.map((v) => {
          const p = v.profile; const s = v.summary;
          const where = p.scope === 'project' ? `Job ${v.projectCode ?? ''}` : p.scope === 'asset' ? `Asset · ${v.assetName ?? ''}` : SCOPE_LABEL.company;
          const tone = v.reviewStatus === 'overdue' ? ' regs__fact--bad' : v.reviewStatus === 'due_soon' ? ' regs__fact--warn' : '';
          return (
            <article key={p.id} className={`card regs__row${p.status === 'archived' ? ' regs__row--retired' : ''}`}>
              <div className="regs__head">
                <PickBox id={p.id} pick={pick} label={p.name} />
                <div className="regs__title">
                  <p className="regs__name"><Link href={`/risks/${p.id}${q}`}>{p.name}</Link></p>
                  <p className="caption regs__meta">{where} · {PROFILE_STATUS_LABEL[p.status]}{p.owner_name ? ` · owner ${p.owner_name}` : ''}</p>
                </div>
                <Link className="button button--quiet regs__edit" href={`/risks/${p.id}${q}`}>Open</Link>
              </div>
              <div className="regs__facts">
                <span className="regs__fact"><span className="regs__fact-label">Open risks</span><span className="regs__fact-text">{s.open}{s.critical ? ` · ${s.critical} critical` : ''}</span></span>
                <span className={`regs__fact${s.uncontrolled > 0 ? ' regs__fact--bad' : s.open > 0 ? ' regs__fact--ok' : ''}`}><span className="regs__fact-label">No control in place</span><span className="regs__fact-text">{s.uncontrolled}</span></span>
                <span className={`regs__fact${s.controlsOverdue > 0 ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Controls planned</span><span className="regs__fact-text">{s.controlsPlanned}{s.controlsOverdue ? ` · ${s.controlsOverdue} overdue` : ''}</span></span>
                <span className={`regs__fact${tone}`}><span className="regs__fact-label">Review</span><span className="regs__fact-text">{v.reviewDue ? fmtDay(v.reviewDue) : '—'}</span>{v.lastReviewedOn && <span className="regs__fact-sub">last {fmtDay(v.lastReviewedOn)}</span>}</span>
              </div>
            </article>
          );
        })}
      </div>

      {isOffice && (
        <Fold label={data.matrixOwn ? 'The company’s risk matrix' : 'The risk matrix — the built-in, until the company sets its own'}>
          <MatrixEditor orgId={orgId} matrix={data.matrix} own={data.matrixOwn} note={data.matrixNote} />
        </Fold>
      )}
      {!isOffice && (
        <Fold label={data.matrixOwn ? 'The company’s risk matrix' : 'The risk matrix'}>
          <MatrixTable matrix={data.matrix} />
        </Fold>
      )}
    </div>
  );
}

/** The dashboard's three gauges: the average likelihood × consequence, where it sits, and the levels under it. */
export function Gauges({ summary }: { summary: RiskSummary }) {
  const gauge = (label: string, avg: number | null, counts: LevelCounts) => {
    const lvl = gaugeLevel(avg);
    const total = RISK_LEVELS.reduce((n, l) => n + counts[l], 0);
    return (
      <div className="safety__tile risk-gauge">
        <p className="label">{label}</p>
        <p className="entries-summary__value mono" style={{ color: lvl ? LEVEL_COLOUR[lvl] : undefined }}>{avg == null ? '—' : avg.toFixed(1)}</p>
        <p className="caption">{lvl ? `${RISK_LABEL[lvl]} on average` : total ? 'Levels only — no likelihood × consequence given' : 'No open risks rated'}</p>
        {total > 0 && (
          <div className="risk-gauge__bar" aria-label={`${label}: ${RISK_LEVELS.map((l) => `${counts[l]} ${RISK_LABEL[l]}`).join(', ')}`}>
            {RISK_LEVELS.map((l) => counts[l] > 0 && <span key={l} style={{ flex: counts[l], background: LEVEL_COLOUR[l] }} title={`${counts[l]} ${RISK_LABEL[l]}`}>{counts[l]}</span>)}
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="safety__tiles">
        {gauge('Inherent', summary.averages.inherent, summary.levels.inherent)}
        {gauge('Residual', summary.averages.residual, summary.levels.residual)}
        {gauge('Potential', summary.averages.potential, summary.levels.potential)}
      </div>
      <div className="regs__counts" style={{ marginTop: '0.75rem' }}>
        <p>
          <strong>{summary.open}</strong> open {summary.open === 1 ? 'risk' : 'risks'} · {summary.critical} critical · {summary.highResidual} high or extreme after controls
        </p>
        <p>
          {summary.uncontrolled > 0 ? <strong style={{ color: '#9a2f2f' }}>{summary.uncontrolled} with no control in place</strong> : '0 with no control in place'}
          {summary.criticalUncontrolled > 0 && <strong style={{ color: '#9a2f2f' }}> · {summary.criticalUncontrolled} of them critical</strong>}
          {' · '}{summary.controlsPlanned} {summary.controlsPlanned === 1 ? 'control' : 'controls'} planned
          {summary.controlsOverdue > 0 && <strong style={{ color: '#9a2f2f' }}> · {summary.controlsOverdue} overdue</strong>}
        </p>
      </div>
    </>
  );
}

function AddProfile({ orgId, projectId, jobCode, assets, canAssessJob, isOffice, onDone }: {
  orgId: string; projectId: string; jobCode: string; assets: Props['assets']; canAssessJob: boolean; isOffice: boolean; onDone: () => void;
}) {
  const save = useSave();
  const [scope, setScope] = useState<ProfileScope>(canAssessJob ? 'project' : 'company');
  const [assetId, setAssetId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [originator, setOriginator] = useState('');
  const [assessor, setAssessor] = useState('');
  const [owner, setOwner] = useState('');
  const [months, setMonths] = useState('12');

  async function add() {
    if (!name.trim()) { save.setError('Name the profile — what it assesses.'); return; }
    if (scope === 'asset' && !assetId) { save.setError('Pick the asset.'); return; }
    let interval: number | null;
    try { interval = readMonths(months); } catch (e) { save.setError((e as Error).message); return; }
    if (interval == null) { save.setError('Say how often it is reviewed — months, 1 to 60.'); return; }
    const ok = await save.run('profile', async () => {
      const { error } = await createClient().from('risk_profiles').insert({
        org_id: orgId, scope, project_id: scope === 'project' ? projectId : null, asset_id: scope === 'asset' ? assetId : null,
        name: name.trim(), description: blankToNull(description), originator_name: blankToNull(originator), assessor_name: blankToNull(assessor), owner_name: blankToNull(owner),
        review_interval_months: interval,
      });
      if (error) throw new Error(error.message);
      return 'Profile started — open it to add its risks.';
    });
    if (ok) onDone();
  }

  return (
    <div className="regs__form">
      <p className="label">Start a profile</p>
      <div className="regs__fields">
        <Field label="What it covers">
          <select className="field field--sm" value={scope} onChange={(e) => setScope(e.target.value as ProfileScope)}>
            {canAssessJob && <option value="project">This job ({jobCode})</option>}
            {isOffice && <option value="company">The company</option>}
            {isOffice && <option value="asset">An asset</option>}
          </select>
        </Field>
        {scope === 'asset' && (
          <Field label="Asset">
            <select className="field field--sm" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Pick one…</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.asset_no ? ` · ${a.asset_no}` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Name" wide><input className="field field--sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trenching and backfill, Stage 2" /></Field>
        <Field label="Description" wide><input className="field field--sm" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Originator"><input className="field field--sm" value={originator} onChange={(e) => setOriginator(e.target.value)} placeholder="Who raised it" /></Field>
        <Field label="Assessor"><input className="field field--sm" value={assessor} onChange={(e) => setAssessor(e.target.value)} placeholder="Who rated it" /></Field>
        <Field label="Owner"><input className="field field--sm" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who answers for it" /></Field>
        <Field label="Reviewed every (months)"><input className="field field--sm" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
      </div>
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions">
        <button type="button" className="button" disabled={Boolean(save.busy)} onClick={add}>Start it</button>
        <button type="button" className="linklike" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function MatrixTable({ matrix, onChange }: { matrix: Matrix; onChange?: (row: number, col: number, level: RiskLevel) => void }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="safety__table risk-matrix">
        <thead>
          <tr><th>Likelihood ↓ · Consequence →</th>{CONSEQUENCE.map((c) => <th key={c}>{CONSEQUENCE_LABEL[c]}</th>)}</tr>
        </thead>
        <tbody>
          {LIKELIHOOD.map((l, i) => (
            <tr key={l}>
              <th>{LIKELIHOOD_LABEL[l]}</th>
              {CONSEQUENCE.map((c, j) => (
                <td key={c} style={{ color: LEVEL_COLOUR[matrix[i][j]], fontWeight: 600 }}>
                  {onChange
                    ? <select className="field field--sm" aria-label={`${LIKELIHOOD_LABEL[l]} × ${CONSEQUENCE_LABEL[c]}`} value={matrix[i][j]} onChange={(e) => onChange(i, j, e.target.value as RiskLevel)} style={{ color: LEVEL_COLOUR[matrix[i][j]] }}>
                        {RISK_LEVELS.map((lv) => <option key={lv} value={lv}>{RISK_LABEL[lv]}</option>)}
                      </select>
                    : RISK_LABEL[matrix[i][j]]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixEditor({ orgId, matrix, own, note }: { orgId: string; matrix: Matrix; own: boolean; note: string | null }) {
  const save = useSave();
  const [cells, setCells] = useState<RiskLevel[][]>(matrix.map((r) => [...r]));
  const [text, setText] = useState(note ?? '');
  const set = (i: number, j: number, level: RiskLevel) => setCells((prev) => prev.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? level : c)) : r)));
  const reset = () => setCells(DEFAULT_MATRIX.map((r) => [...r]));
  const changed = JSON.stringify(cells) !== JSON.stringify(matrix) || (text.trim() || null) !== note;
  async function keep() {
    await save.run('matrix', async () => {
      const { error } = await createClient().from('org_risk_matrices').upsert({ org_id: orgId, cells, note: blankToNull(text) }, { onConflict: 'org_id' });
      if (error) throw new Error(error.message);
      return 'Matrix kept. Risks rated from now on use it; ratings already made stand as they were.';
    });
  }
  return (
    <div>
      <p className="caption">Each cell is the level a likelihood and consequence rate at. The built-in is the SWMS&rsquo;s. Changing a cell changes how new ratings are read — a rating already on a risk keeps the level it was given.</p>
      <MatrixTable matrix={cells} onChange={set} />
      <Field label="Note — where this matrix comes from" wide><input className="field field--sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Head contractor's HSE standard, rev 4" /></Field>
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions">
        <button type="button" className="button" disabled={!changed || Boolean(save.busy)} onClick={keep}>{own ? 'Keep the changes' : 'Set it as the company’s'}</button>
        <button type="button" className="linklike" onClick={reset}>Back to the built-in</button>
      </div>
    </div>
  );
}
