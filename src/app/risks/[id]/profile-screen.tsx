'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { fmtDay } from '@/lib/registers/model';
import { Fold } from '@/components/fold';
import { CONTROL_LEVELS, CONTROL_LEVEL_LABEL, CONTROL_LEVEL_SHORT, hazardTypeLabel, hazardTypeOptions, type ControlLevel } from '@/lib/incidents/controls';
import { PRIORITY_LABEL, ACTION_PRIORITIES, type ActionPriority } from '@/lib/actions/model';
import {
  CONSEQUENCE, CONSEQUENCE_LABEL, LIKELIHOOD, LIKELIHOOD_LABEL, PROFILE_STATUS_LABEL, RISK_CONTROL_STATE_LABEL, RISK_LABEL, RISK_LEVELS,
  proposeFromSwms, ratingText, riskControlState, riskLevelOn, riskProblems, riskRef, sortRisks, summariseRisks,
  type Consequence, type ControlRow, type Likelihood, type Matrix, type RiskLevel, type RiskRow, type SwmsStepFacts,
} from '@/lib/risks/model';
import type { ProfileVerdict } from '@/lib/risks/load';
import { Gauges } from '../risks-screen';
import { Field, Messages, blankToNull, readMonths, useSave } from '../../registers/shared';

export interface SwmsOption { id: string; title: string; kind: string; version: number; steps: SwmsStepFacts[] }
type Person = { id: string; name: string };
type HazardType = { kind: string; key: string; label: string; active: boolean };

interface Props {
  projectId: string; userId: string; today: string;
  verdict: ProfileVerdict; risks: RiskRow[]; controls: ControlRow[]; matrix: Matrix;
  reviews: Array<{ id: string; reviewed_on: string; reviewed_by_name: string; note: string | null }>;
  people: Person[]; hazardTypes: HazardType[]; swms: SwmsOption[]; canWrite: boolean;
}

const LEVEL_TONE: Record<RiskLevel, string> = { low: ' regs__fact--ok', medium: ' regs__fact--warn', high: ' regs__fact--bad', extreme: ' regs__fact--bad' };
const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

export function ProfileScreen({ projectId, today, verdict, risks, controls, matrix, reviews, people, hazardTypes, swms, canWrite }: Props) {
  const p = verdict.profile;
  const frozen = p.status === 'archived';
  const write = canWrite && !frozen;
  const summary = useMemo(() => summariseRisks(risks, controls, today), [risks, controls, today]);
  const sorted = useMemo(() => sortRisks(risks), [risks]);
  const [adding, setAdding] = useState(false);
  const nameOf = (id: string | null) => (id ? people.find((x) => x.id === id)?.name ?? 'Someone on another job' : null);
  const reviewTone = verdict.reviewStatus === 'overdue' ? ' regs__fact--bad' : verdict.reviewStatus === 'due_soon' ? ' regs__fact--warn' : verdict.reviewStatus === 'ok' ? ' regs__fact--ok' : '';

  return (
    <div className="regs">
      <div className="regs__facts">
        <span className="regs__fact"><span className="regs__fact-label">Originator</span><span className="regs__fact-text">{dash(p.originator_name)}</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Assessor</span><span className="regs__fact-text">{dash(p.assessor_name)}</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Owner</span><span className="regs__fact-text">{dash(p.owner_name)}</span></span>
        <span className={`regs__fact${reviewTone}`}>
          <span className="regs__fact-label">Review {verdict.reviewStatus === 'overdue' ? 'overdue' : 'due'}</span>
          <span className="regs__fact-text">{verdict.reviewDue ? fmtDay(verdict.reviewDue) : '—'}</span>
          <span className="regs__fact-sub">{verdict.lastReviewedOn ? `last reviewed ${fmtDay(verdict.lastReviewedOn)}` : `every ${p.review_interval_months} months from ${fmtPerthDate(p.created_at)}`}</span>
        </span>
        <span className="regs__fact"><span className="regs__fact-label">Status</span><span className="regs__fact-text">{PROFILE_STATUS_LABEL[p.status]}</span>{p.archived_reason && <span className="regs__fact-sub">{p.archived_reason}</span>}</span>
      </div>
      <p className="regs__links" style={{ marginTop: '0.5rem' }}>
        <a className="linklike" href={`/api/risks/pdf?project=${projectId}&profile=${p.id}`} target="_blank" rel="noreferrer">Print this profile</a>
      </p>

      <Gauges summary={summary} />

      {canWrite && (
        <Fold label="The profile — review, status, its facts">
          <ProfileAdmin profile={p} today={today} reviews={reviews} />
        </Fold>
      )}
      {!canWrite && reviews.length > 0 && (
        <Fold label="Reviews" count={reviews.length}><ReviewList reviews={reviews} /></Fold>
      )}

      {write && swms.length > 0 && (
        <Fold label="Bring in a SWMS" count={swms.length}>
          <ImportSwms profile={p} swms={swms} risks={risks} />
        </Fold>
      )}

      <p className="label regs__sub">Risks · {summary.open} open{summary.closed ? ` · ${summary.closed} closed` : ''}</p>
      {write && (adding
        ? <RiskForm profile={p} matrix={matrix} people={people} hazardTypes={hazardTypes} onDone={() => setAdding(false)} />
        : <button type="button" className="button" onClick={() => setAdding(true)}>Add a risk</button>)}

      <div className="regs__list" style={{ marginTop: '0.75rem' }}>
        {sorted.length === 0 && <p className="caption">No risks on this profile yet{swms.length > 0 ? ' — bring the SWMS steps in, or add one' : ''}.</p>}
        {sorted.map((r) => (
          <RiskCard key={r.id} risk={r} controls={controls.filter((c) => c.risk_id === r.id)} profile={p} matrix={matrix} people={people} hazardTypes={hazardTypes} today={today} write={write} nameOf={nameOf} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   The profile's own facts, review and status
   ------------------------------------------------------------------------------------------------ */

function ReviewList({ reviews }: { reviews: Props['reviews'] }) {
  return (
    <ul className="regs__others">
      {reviews.map((r) => <li key={r.id}>{fmtDay(r.reviewed_on)} · {r.reviewed_by_name}{r.note ? ` — ${r.note}` : ''}</li>)}
    </ul>
  );
}

function ProfileAdmin({ profile: p, today, reviews }: { profile: ProfileVerdict['profile']; today: string; reviews: Props['reviews'] }) {
  const save = useSave();
  const frozen = p.status === 'archived';
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? '');
  const [originator, setOriginator] = useState(p.originator_name ?? '');
  const [assessor, setAssessor] = useState(p.assessor_name ?? '');
  const [owner, setOwner] = useState(p.owner_name ?? '');
  const [months, setMonths] = useState(String(p.review_interval_months));
  const [reviewOn, setReviewOn] = useState(today);
  const [reviewBy, setReviewBy] = useState(p.assessor_name ?? '');
  const [reviewNote, setReviewNote] = useState('');
  const [archiveReason, setArchiveReason] = useState('');

  const keep = () => save.run('facts', async () => {
    if (!name.trim()) throw new Error('The profile keeps a name.');
    const interval = readMonths(months);
    if (interval == null) throw new Error('Reviewed every so many months, 1 to 60.');
    const { error } = await createClient().from('risk_profiles').update({
      name: name.trim(), description: blankToNull(description), originator_name: blankToNull(originator), assessor_name: blankToNull(assessor), owner_name: blankToNull(owner), review_interval_months: interval,
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
  });
  const makeCurrent = () => save.run('current', async () => {
    const { error } = await createClient().from('risk_profiles').update({ status: 'current' }).eq('id', p.id);
    if (error) throw new Error(error.message);
    return 'The profile is current.';
  });
  const review = () => save.run('review', async () => {
    if (!reviewBy.trim()) throw new Error('Who reviewed it?');
    const { error } = await createClient().from('risk_profile_reviews').insert({ profile_id: p.id, reviewed_on: reviewOn, reviewed_by_name: reviewBy.trim(), note: blankToNull(reviewNote) });
    if (error) throw new Error(error.message);
    setReviewNote('');
    return 'Review recorded — the next one counts from it.';
  });
  const archive = () => save.run('archive', async () => {
    if (!archiveReason.trim()) throw new Error('Say why the profile is archived.');
    const { error } = await createClient().from('risk_profiles').update({ status: 'archived', archived_reason: archiveReason.trim() }).eq('id', p.id);
    if (error) throw new Error(error.message);
    return 'Archived. It stays on the record, frozen.';
  });

  return (
    <div>
      {!frozen && (
        <>
          <p className="label">Record a review</p>
          <div className="regs__fields">
            <Field label="Reviewed on"><input className="field field--sm" type="date" max={today} value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} /></Field>
            <Field label="By"><input className="field field--sm" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} /></Field>
            <Field label="Note" wide><input className="field field--sm" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="What changed, or that nothing did" /></Field>
          </div>
          <div className="regs__actions"><button type="button" className="button button--quiet" disabled={Boolean(save.busy)} onClick={review}>Record the review</button></div>
        </>
      )}
      {reviews.length > 0 && <><p className="label regs__sub">Reviews · {reviews.length}</p><ReviewList reviews={reviews} /></>}

      {!frozen && (
        <>
          <p className="label regs__sub">Its facts</p>
          <div className="regs__fields">
            <Field label="Name" wide><input className="field field--sm" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Description" wide><input className="field field--sm" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Originator"><input className="field field--sm" value={originator} onChange={(e) => setOriginator(e.target.value)} /></Field>
            <Field label="Assessor"><input className="field field--sm" value={assessor} onChange={(e) => setAssessor(e.target.value)} /></Field>
            <Field label="Owner"><input className="field field--sm" value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
            <Field label="Reviewed every (months)"><input className="field field--sm" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
          </div>
          <div className="regs__actions">
            <button type="button" className="button button--quiet" disabled={Boolean(save.busy)} onClick={keep}>Keep the facts</button>
            {p.status === 'draft' && <button type="button" className="button" disabled={Boolean(save.busy)} onClick={makeCurrent}>Make it current</button>}
          </div>

          <p className="label regs__sub">Archive</p>
          <p className="caption">An archived profile is frozen — its risks and controls stay as they stood. A new assessment is a new profile.</p>
          <div className="regs__fields">
            <Field label="Why" wide><input className="field field--sm" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="Superseded by…, works complete, …" /></Field>
          </div>
          <div className="regs__actions"><button type="button" className="button button--quiet" disabled={!archiveReason.trim() || Boolean(save.busy)} onClick={archive}>Archive the profile</button></div>
        </>
      )}
      <Messages error={save.error} notice={save.notice} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   The SWMS feed
   ------------------------------------------------------------------------------------------------ */

function ImportSwms({ profile, swms, risks }: { profile: ProfileVerdict['profile']; swms: SwmsOption[]; risks: RiskRow[] }) {
  const save = useSave();
  const [swmsId, setSwmsId] = useState(swms[0]?.id ?? '');
  const chosen = swms.find((s) => s.id === swmsId) ?? null;
  const proposal = useMemo(() => (chosen ? proposeFromSwms(chosen.title, chosen.steps, risks.filter((r) => r.source_swms_id === chosen.id)) : null), [chosen, risks]);

  const bring = () => save.run('import', async () => {
    if (!chosen || !proposal || proposal.risks.length === 0) throw new Error('Nothing to bring in.');
    const supabase = createClient();
    let added = 0;
    for (const pr of proposal.risks) {
      const { data: row, error } = await supabase.from('risks').insert({
        org_id: profile.org_id, profile_id: profile.id, task: pr.task, step: pr.step, hazard: pr.hazard,
        inherent_level: pr.inherent_level, residual_level: pr.residual_level, source_swms_id: chosen.id, source_step: pr.source_step,
      }).select('id').single();
      if (error) throw new Error(`${added} brought in, then: ${error.message}`);
      if (pr.control) {
        const { error: ce } = await supabase.from('risk_controls').insert({ risk_id: row.id, description: pr.control, kind: 'existing', critical: false });
        if (ce) throw new Error(`Risk ${pr.source_step} is in but its control failed: ${ce.message}`);
      }
      added += 1;
    }
    return `${added} ${added === 1 ? 'risk' : 'risks'} brought in from ${chosen.title} — levels as the SWMS rated them; add the likelihood and consequence, and class each control, on the risk.`;
  });

  return (
    <div>
      <p className="caption">Each rated step of an active SWMS becomes a risk: its hazards, the &ldquo;before&rdquo; level as the inherent, the &ldquo;after&rdquo; as the residual, and its controls as one existing control in the SWMS&rsquo;s own words. Nothing is invented — a step with no hazard or no rating is left out.</p>
      <div className="regs__fields">
        <Field label="SWMS" wide>
          <select className="field field--sm" value={swmsId} onChange={(e) => setSwmsId(e.target.value)}>
            {swms.map((s) => <option key={s.id} value={s.id}>{s.title} · v{s.version} ({s.kind.toUpperCase()})</option>)}
          </select>
        </Field>
      </div>
      {proposal && (
        <>
          <p className="caption">
            {proposal.risks.length} {proposal.risks.length === 1 ? 'step' : 'steps'} to bring in
            {proposal.skipped > 0 && ` · ${proposal.skipped} left out — no hazard or no rating written`}
            {chosen && chosen.steps.length - proposal.risks.length - proposal.skipped > 0 && ` · ${chosen.steps.length - proposal.risks.length - proposal.skipped} already on this profile`}
          </p>
          {proposal.risks.length > 0 && (
            <ul className="regs__others">
              {proposal.risks.map((r) => <li key={r.source_step}>Step {r.source_step}{r.step ? ` · ${r.step}` : ''} — {r.hazard} · {RISK_LABEL[r.inherent_level]}{r.residual_level ? ` → ${RISK_LABEL[r.residual_level]}` : ''}{r.control ? ` · ${r.control}` : ''}</li>)}
            </ul>
          )}
        </>
      )}
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions"><button type="button" className="button" disabled={!proposal || proposal.risks.length === 0 || Boolean(save.busy)} onClick={bring}>Bring them in</button></div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   A risk
   ------------------------------------------------------------------------------------------------ */

function RatingPick({ label, likelihood, consequence, matrix, onChange, levelOnly, onLevel }: {
  label: string; likelihood: Likelihood | ''; consequence: Consequence | ''; matrix: Matrix;
  onChange: (l: Likelihood | '', c: Consequence | '') => void;
  /** For the inherent rating when no pair is given: a level typed by hand. */
  levelOnly?: RiskLevel | ''; onLevel?: (l: RiskLevel | '') => void;
}) {
  const level = likelihood && consequence ? riskLevelOn(matrix, likelihood, consequence) : null;
  return (
    <>
      <Field label={`${label} — likelihood`}>
        <select className="field field--sm" value={likelihood} onChange={(e) => onChange(e.target.value as Likelihood | '', consequence)}>
          <option value="">Not rated</option>
          {LIKELIHOOD.map((l) => <option key={l} value={l}>{LIKELIHOOD_LABEL[l]}</option>)}
        </select>
      </Field>
      <Field label={`${label} — consequence`}>
        <select className="field field--sm" value={consequence} onChange={(e) => onChange(likelihood, e.target.value as Consequence | '')}>
          <option value="">Not rated</option>
          {CONSEQUENCE.map((c) => <option key={c} value={c}>{CONSEQUENCE_LABEL[c]}</option>)}
        </select>
      </Field>
      {level
        ? <span className={`regs__fact${LEVEL_TONE[level]}`}><span className="regs__fact-label">{label} level</span><span className="regs__fact-text">{RISK_LABEL[level]}</span><span className="regs__fact-sub">from the matrix</span></span>
        : onLevel
          ? <Field label={`${label} level (when no pair is given)`}>
              <select className="field field--sm" value={levelOnly ?? ''} onChange={(e) => onLevel(e.target.value as RiskLevel | '')}>
                <option value="">—</option>
                {RISK_LEVELS.map((l) => <option key={l} value={l}>{RISK_LABEL[l]}</option>)}
              </select>
            </Field>
          : <span className="regs__fact"><span className="regs__fact-label">{label} level</span><span className="regs__fact-text">—</span></span>}
    </>
  );
}

function RiskForm({ profile, matrix, people, hazardTypes, existing, onDone }: {
  profile: ProfileVerdict['profile']; matrix: Matrix; people: Person[]; hazardTypes: HazardType[]; existing?: RiskRow; onDone: () => void;
}) {
  const save = useSave();
  const [task, setTask] = useState(existing?.task ?? '');
  const [step, setStep] = useState(existing?.step ?? '');
  const [hazard, setHazard] = useState(existing?.hazard ?? '');
  const [hazardType, setHazardType] = useState(existing?.hazard_type ?? '');
  const [event, setEvent] = useState(existing?.unwanted_event ?? '');
  const [inh, setInh] = useState<[Likelihood | '', Consequence | '']>([existing?.inherent_likelihood ?? '', existing?.inherent_consequence ?? '']);
  const [inhLevel, setInhLevel] = useState<RiskLevel | ''>(existing?.inherent_level ?? '');
  const [res, setRes] = useState<[Likelihood | '', Consequence | '']>([existing?.residual_likelihood ?? '', existing?.residual_consequence ?? '']);
  const [pot, setPot] = useState<[Likelihood | '', Consequence | '']>([existing?.potential_likelihood ?? '', existing?.potential_consequence ?? '']);
  const [critical, setCritical] = useState(existing?.critical ?? false);
  const [owner, setOwner] = useState(existing?.owner_name ?? '');
  const [assignee, setAssignee] = useState(existing?.assigned_to ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const options = hazardTypeOptions(hazardTypes);

  async function keep() {
    const inherentLevel = inh[0] && inh[1] ? riskLevelOn(matrix, inh[0], inh[1]) : inhLevel;
    const draft = {
      task, hazard,
      inherent_likelihood: inh[0] || null, inherent_consequence: inh[1] || null, inherent_level: inherentLevel as RiskLevel,
      residual_likelihood: res[0] || null, residual_consequence: res[1] || null,
      potential_likelihood: pot[0] || null, potential_consequence: pot[1] || null,
    };
    const problems = riskProblems(draft);
    if (problems.length) { save.setError(problems.join(' ')); return; }
    const row = {
      task: task.trim(), step: blankToNull(step), hazard: hazard.trim(), hazard_type: hazardType || null, unwanted_event: blankToNull(event),
      inherent_likelihood: draft.inherent_likelihood, inherent_consequence: draft.inherent_consequence, inherent_level: inherentLevel,
      residual_likelihood: draft.residual_likelihood, residual_consequence: draft.residual_consequence,
      residual_level: res[0] && res[1] ? riskLevelOn(matrix, res[0], res[1]) : existing && !res[0] && !res[1] ? existing.residual_level : null,
      potential_likelihood: draft.potential_likelihood, potential_consequence: draft.potential_consequence,
      potential_level: pot[0] && pot[1] ? riskLevelOn(matrix, pot[0], pot[1]) : null,
      critical, owner_name: blankToNull(owner), assigned_to: assignee || null, notes: blankToNull(notes),
    };
    const ok = await save.run('risk', async () => {
      const supabase = createClient();
      const { error } = existing
        ? await supabase.from('risks').update(row).eq('id', existing.id)
        : await supabase.from('risks').insert({ org_id: profile.org_id, profile_id: profile.id, ...row });
      if (error) throw new Error(error.message);
      return existing ? 'Risk updated.' : 'Risk added — now its controls.';
    });
    if (ok) onDone();
  }

  return (
    <div className="regs__form">
      <p className="label">{existing ? `Edit ${riskRef(existing.seq)}` : 'A risk'}</p>
      <div className="regs__fields">
        <Field label="Task" wide><input className="field field--sm" value={task} onChange={(e) => setTask(e.target.value)} placeholder="The work being done" /></Field>
        <Field label="Step" wide><input className="field field--sm" value={step} onChange={(e) => setStep(e.target.value)} placeholder="The part of it, if the task has parts" /></Field>
        <Field label="Hazard" wide><input className="field field--sm" value={hazard} onChange={(e) => setHazard(e.target.value)} placeholder="What could cause harm" /></Field>
        <Field label="Hazard type">
          <select className="field field--sm" value={hazardType} onChange={(e) => setHazardType(e.target.value)}>
            <option value="">—</option>
            {options.filter((o) => !o.retired || o.key === hazardType).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Unwanted event" wide><input className="field field--sm" value={event} onChange={(e) => setEvent(e.target.value)} placeholder="What goes wrong — the outcome rated" /></Field>
      </div>
      <p className="label regs__sub">Inherent — before any control</p>
      <div className="regs__fields"><RatingPick label="Inherent" likelihood={inh[0]} consequence={inh[1]} matrix={matrix} onChange={(l, c) => setInh([l, c])} levelOnly={inhLevel} onLevel={setInhLevel} /></div>
      <p className="label regs__sub">Residual — with the existing controls</p>
      <div className="regs__fields"><RatingPick label="Residual" likelihood={res[0]} consequence={res[1]} matrix={matrix} onChange={(l, c) => setRes([l, c])} /></div>
      <p className="label regs__sub">Potential — with the planned controls in place too</p>
      <div className="regs__fields"><RatingPick label="Potential" likelihood={pot[0]} consequence={pot[1]} matrix={matrix} onChange={(l, c) => setPot([l, c])} /></div>
      <div className="regs__fields" style={{ marginTop: '0.75rem' }}>
        <label className="regs__tick regs__field"><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> Critical risk</label>
        <Field label="Owner"><input className="field field--sm" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who answers for it" /></Field>
        <Field label="Assigned to">
          <select className="field field--sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Nobody yet</option>
            {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Notes" wide><input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions">
        <button type="button" className="button" disabled={Boolean(save.busy)} onClick={keep}>{existing ? 'Keep the changes' : 'Add it'}</button>
        <button type="button" className="linklike" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function RiskCard({ risk: r, controls, profile, matrix, people, hazardTypes, today, write, nameOf }: {
  risk: RiskRow; controls: ControlRow[]; profile: ProfileVerdict['profile']; matrix: Matrix; people: Person[]; hazardTypes: HazardType[]; today: string; write: boolean; nameOf: (id: string | null) => string | null;
}) {
  const save = useSave();
  const [editing, setEditing] = useState(false);
  const [addingControl, setAddingControl] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);
  const open = r.status === 'open';
  const state = riskControlState(controls);
  const existing = controls.filter((c) => c.kind === 'existing');
  const planned = controls.filter((c) => c.kind === 'planned');
  const type = hazardTypeLabel(r.hazard_type, hazardTypes);
  const rating = (label: string, level: RiskLevel | null, l: Likelihood | null, c: Consequence | null) => (
    <span className={`regs__fact${level ? LEVEL_TONE[level] : ''}`}><span className="regs__fact-label">{label}</span><span className="regs__fact-text">{level ? RISK_LABEL[level] : '—'}</span>{l && c && <span className="regs__fact-sub">{LIKELIHOOD_LABEL[l]} · {CONSEQUENCE_LABEL[c]}</span>}</span>
  );
  const close = () => save.run('close', async () => {
    if (!closeReason.trim()) throw new Error('Say why the risk is closed.');
    const { error } = await createClient().from('risks').update({ status: 'closed', closed_reason: closeReason.trim() }).eq('id', r.id);
    if (error) throw new Error(error.message);
    setClosing(false);
    return `${riskRef(r.seq)} closed.`;
  });

  return (
    <article className={`card regs__row${open ? '' : ' regs__row--retired'}`} style={{ textAlign: 'left', justifyItems: 'stretch' }}>
      <div className="regs__head">
        <div className="regs__title">
          <p className="regs__name">{riskRef(r.seq)}{r.critical && <strong style={{ color: '#9a2f2f' }}> · Critical</strong>} · {r.task}{r.step ? ` — ${r.step}` : ''}</p>
          <p className="regs__meta"><strong>{r.hazard}</strong>{r.unwanted_event ? ` → ${r.unwanted_event}` : ''}{type ? <span className="caption"> · {type}</span> : null}</p>
        </div>
        {write && open && !editing && <button type="button" className="button button--quiet regs__edit" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {editing
        ? <RiskForm profile={profile} matrix={matrix} people={people} hazardTypes={hazardTypes} existing={r} onDone={() => setEditing(false)} />
        : (
          <div className="regs__facts">
            {rating('Inherent', r.inherent_level, r.inherent_likelihood, r.inherent_consequence)}
            {rating('Residual', r.residual_level, r.residual_likelihood, r.residual_consequence)}
            {rating('Potential', r.potential_level, r.potential_likelihood, r.potential_consequence)}
            <span className={`regs__fact${open ? (state === 'controlled' ? ' regs__fact--ok' : ' regs__fact--bad') : ''}`}>
              <span className="regs__fact-label">{open ? 'Controls' : 'Closed'}</span>
              <span className="regs__fact-text">{open ? RISK_CONTROL_STATE_LABEL[state] : fmtPerthDate(r.closed_at)}</span>
              {!open && r.closed_reason && <span className="regs__fact-sub">{r.closed_reason}</span>}
            </span>
            {(r.owner_name || r.assigned_to) && <span className="regs__fact"><span className="regs__fact-label">Owner · assigned</span><span className="regs__fact-text">{dash(r.owner_name)}</span>{r.assigned_to && <span className="regs__fact-sub">{nameOf(r.assigned_to)}</span>}</span>}
          </div>
        )}
      {r.notes && !editing && <p className="caption" style={{ margin: '0.4rem 0 0' }}>{r.notes}</p>}

      <ControlList title="Existing controls" rows={existing} write={write && open} today={today} nameOf={nameOf} />
      <ControlList title="Planned controls" rows={planned} write={write && open} today={today} nameOf={nameOf} />
      {write && open && (addingControl
        ? <ControlForm risk={r} people={people} today={today} onDone={() => setAddingControl(false)} />
        : <div className="regs__actions">
            <button type="button" className="button button--quiet" onClick={() => setAddingControl(true)}>Add a control</button>
            {!closing && <button type="button" className="linklike" onClick={() => setClosing(true)}>Close this risk</button>}
          </div>)}
      {write && open && closing && (
        <div className="regs__form">
          <div className="regs__fields"><Field label="Why it is closed" wide><input className="field field--sm" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Task complete, hazard eliminated, …" /></Field></div>
          <div className="regs__actions">
            <button type="button" className="button button--quiet" disabled={Boolean(save.busy)} onClick={close}>Close {riskRef(r.seq)}</button>
            <button type="button" className="linklike" onClick={() => setClosing(false)}>Keep it open</button>
          </div>
        </div>
      )}
      <Messages error={save.error} notice={save.notice} />
    </article>
  );
}

/* ------------------------------------------------------------------------------------------------
   Controls
   ------------------------------------------------------------------------------------------------ */

function ControlList({ title, rows, write, today, nameOf }: { title: string; rows: ControlRow[]; write: boolean; today: string; nameOf: (id: string | null) => string | null }) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className="label regs__sub">{title} · {rows.filter((c) => c.status !== 'withdrawn').length}</p>
      <ul className="regs__others">
        {rows.map((c) => <ControlLine key={c.id} control={c} write={write} today={today} nameOf={nameOf} />)}
      </ul>
    </>
  );
}

function ControlLine({ control: c, write, today, nameOf }: { control: ControlRow; write: boolean; today: string; nameOf: (id: string | null) => string | null }) {
  const save = useSave();
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [inPlacing, setInPlacing] = useState(false);
  const late = c.status === 'planned' && c.due_on != null && c.due_on < today;
  const inPlace = () => save.run('in place', async () => {
    const { error } = await createClient().from('risk_controls').update({ status: 'in_place', in_place_note: blankToNull(note) }).eq('id', c.id);
    if (error) throw new Error(error.message);
    setInPlacing(false);
    return 'In place — its action is done.';
  });
  const withdraw = () => save.run('withdraw', async () => {
    if (!reason.trim()) throw new Error('Say why the control was withdrawn.');
    const { error } = await createClient().from('risk_controls').update({ status: 'withdrawn', withdrawn_reason: reason.trim() }).eq('id', c.id);
    if (error) throw new Error(error.message);
    setWithdrawing(false);
    return 'Withdrawn.';
  });
  return (
    <li style={{ opacity: c.status === 'withdrawn' ? 0.65 : 1 }}>
      {c.critical && <strong style={{ color: '#9a2f2f' }}>★ </strong>}
      {c.description}
      {c.level && <span className="caption"> [{CONTROL_LEVEL_SHORT[c.level]}]</span>}
      {!c.level && <span className="caption"> [not yet classed]</span>}
      {c.status === 'in_place' && c.kind === 'planned' && <span className="caption"> — in place {fmtPerthDate(c.in_place_at)}{c.in_place_note ? ` · ${c.in_place_note}` : ''}</span>}
      {c.status === 'planned' && <span className="caption" style={{ color: late ? '#9a2f2f' : undefined }}> — {late ? 'overdue' : 'due'} {c.due_on ? fmtDay(c.due_on) : 'undated'}{c.assigned_to ? ` · ${nameOf(c.assigned_to)}` : ''}{c.priority !== 'normal' ? ` · ${PRIORITY_LABEL[c.priority]}` : ''}</span>}
      {c.status === 'withdrawn' && <span className="caption"> — withdrawn {fmtPerthDate(c.withdrawn_at)}: {c.withdrawn_reason}</span>}
      {write && c.status !== 'withdrawn' && (
        <span className="regs__links" style={{ display: 'inline-flex', marginLeft: '0.6rem', gap: '0.6rem' }}>
          {c.status === 'planned' && !inPlacing && <button type="button" className="linklike" onClick={() => setInPlacing(true)}>Now in place</button>}
          {!withdrawing && <button type="button" className="linklike" onClick={() => setWithdrawing(true)}>Withdraw</button>}
        </span>
      )}
      {inPlacing && (
        <span className="regs__fields" style={{ marginTop: '0.3rem' }}>
          <Field label="How it was put in place (optional)" wide><input className="field field--sm" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <span className="regs__actions"><button type="button" className="button button--quiet" disabled={Boolean(save.busy)} onClick={inPlace}>It is in place</button><button type="button" className="linklike" onClick={() => setInPlacing(false)}>Cancel</button></span>
        </span>
      )}
      {withdrawing && (
        <span className="regs__fields" style={{ marginTop: '0.3rem' }}>
          <Field label="Why" wide><input className="field field--sm" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <span className="regs__actions"><button type="button" className="button button--quiet" disabled={Boolean(save.busy)} onClick={withdraw}>Withdraw it</button><button type="button" className="linklike" onClick={() => setWithdrawing(false)}>Cancel</button></span>
        </span>
      )}
      <Messages error={save.error} notice={save.notice} />
    </li>
  );
}

function ControlForm({ risk, people, today, onDone }: { risk: RiskRow; people: Person[]; today: string; onDone: () => void }) {
  const save = useSave();
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<ControlLevel | ''>('');
  const [kind, setKind] = useState<'existing' | 'planned'>('existing');
  const [critical, setCritical] = useState(false);
  const [dueOn, setDueOn] = useState('');
  const [priority, setPriority] = useState<ActionPriority>('normal');
  const [assignee, setAssignee] = useState('');
  const [owner, setOwner] = useState(risk.owner_name ?? '');
  async function add() {
    if (!description.trim()) { save.setError('Say what the control is.'); return; }
    const ok = await save.run('control', async () => {
      const { error } = await createClient().from('risk_controls').insert({
        risk_id: risk.id, description: description.trim(), level: level || null, kind, critical,
        due_on: kind === 'planned' && dueOn ? dueOn : null, priority: kind === 'planned' ? priority : 'normal',
        assigned_to: kind === 'planned' && assignee ? assignee : null, owner_name: blankToNull(owner),
      });
      if (error) throw new Error(error.message);
      return kind === 'planned' ? 'Planned — it is on the action register until it is in place.' : 'Control recorded as in place.';
    });
    if (ok) onDone();
  }
  return (
    <div className="regs__form">
      <p className="label">A control on {riskRef(risk.seq)}</p>
      <div className="regs__fields">
        <Field label="The control" wide><input className="field field--sm" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="On the hierarchy">
          <select className="field field--sm" value={level} onChange={(e) => setLevel(e.target.value as ControlLevel | '')}>
            <option value="">Not yet classed</option>
            {CONTROL_LEVELS.map((l) => <option key={l} value={l}>{CONTROL_LEVEL_LABEL[l]}</option>)}
          </select>
        </Field>
        <Field label="Existing or planned">
          <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as 'existing' | 'planned')}>
            <option value="existing">Existing — in place now</option>
            <option value="planned">Planned — an action until it is in place</option>
          </select>
        </Field>
        <label className="regs__tick regs__field"><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> Critical control</label>
        <Field label="Owner"><input className="field field--sm" value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
        {kind === 'planned' && (
          <>
            <Field label="Due"><input className="field field--sm" type="date" min={today} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
            <Field label="Priority">
              <select className="field field--sm" value={priority} onChange={(e) => setPriority(e.target.value as ActionPriority)}>
                {ACTION_PRIORITIES.map((pr) => <option key={pr} value={pr}>{PRIORITY_LABEL[pr]}</option>)}
              </select>
            </Field>
            <Field label="Assigned to">
              <select className="field field--sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Nobody yet</option>
                {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions">
        <button type="button" className="button" disabled={Boolean(save.busy)} onClick={add}>Add it</button>
        <button type="button" className="linklike" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
