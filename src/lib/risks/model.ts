/**
 * The risk register (README R187): profiles, risks, controls and the matrix,
 * as facts the screens, the printed register, the Safety dashboard and What's
 * due all read the same way.
 *
 * Pure and dependency-free, with relative imports — node-tested. The database
 * holds the same rules (app.risk_level, app.risk_profile_review_due, the
 * triggers) and wins where they disagree. Nothing here reads a clock: `today`
 * is passed in as a Perth calendar day.
 */
import { CONTROL_LEVEL_RANK, type ControlLevel } from '../incidents/controls.ts';

export const RISK_LEVELS = ['low', 'medium', 'high', 'extreme'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };
const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, extreme: 3 };

export const LIKELIHOOD = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'] as const;
export type Likelihood = (typeof LIKELIHOOD)[number];
export const LIKELIHOOD_LABEL: Record<Likelihood, string> = { rare: 'Rare', unlikely: 'Unlikely', possible: 'Possible', likely: 'Likely', almost_certain: 'Almost certain' };
export const CONSEQUENCE = ['insignificant', 'minor', 'moderate', 'major', 'catastrophic'] as const;
export type Consequence = (typeof CONSEQUENCE)[number];
export const CONSEQUENCE_LABEL: Record<Consequence, string> = { insignificant: 'Insignificant', minor: 'Minor', moderate: 'Moderate', major: 'Major', catastrophic: 'Catastrophic' };

/** Rows likelihood, columns consequence. The SWMS's matrix and `app.risk_matrix_default()` — the three must agree. */
export const DEFAULT_MATRIX: ReadonlyArray<ReadonlyArray<RiskLevel>> = [
  ['low', 'low', 'medium', 'medium', 'high'],
  ['low', 'low', 'medium', 'high', 'high'],
  ['low', 'medium', 'high', 'high', 'extreme'],
  ['medium', 'medium', 'high', 'extreme', 'extreme'],
  ['medium', 'high', 'extreme', 'extreme', 'extreme'],
];
export type Matrix = ReadonlyArray<ReadonlyArray<RiskLevel>>;

/** The matrix as the company keeps it, or the built-in when it has set none or what it set does not parse. */
export function readMatrix(cells: unknown): Matrix {
  if (!Array.isArray(cells) || cells.length !== 5) return DEFAULT_MATRIX;
  const rows: RiskLevel[][] = [];
  for (const row of cells) {
    if (!Array.isArray(row) || row.length !== 5 || !row.every((c) => typeof c === 'string' && (RISK_LEVELS as readonly string[]).includes(c))) return DEFAULT_MATRIX;
    rows.push(row as RiskLevel[]);
  }
  return rows;
}

/** The level a likelihood and consequence rate at on this matrix. The SQL twin is `app.risk_level`. */
export function riskLevelOn(matrix: Matrix, likelihood: Likelihood, consequence: Consequence): RiskLevel {
  return matrix[LIKELIHOOD.indexOf(likelihood)][CONSEQUENCE.indexOf(consequence)];
}

/** Likelihood × consequence, 1 to 25 — the number a gauge averages. Null when either half is unstated. */
export function riskScore(likelihood: Likelihood | null, consequence: Consequence | null): number | null {
  if (!likelihood || !consequence) return null;
  return (LIKELIHOOD.indexOf(likelihood) + 1) * (CONSEQUENCE.indexOf(consequence) + 1);
}

/* ------------------------------------------------------------------------------------------------
   Profiles
   ------------------------------------------------------------------------------------------------ */

export type ProfileScope = 'company' | 'project' | 'asset';
export const SCOPE_LABEL: Record<ProfileScope, string> = { company: 'The company', project: 'This job', asset: 'An asset' };
export type ProfileStatus = 'draft' | 'current' | 'archived';
export const PROFILE_STATUS_LABEL: Record<ProfileStatus, string> = { draft: 'Draft', current: 'Current', archived: 'Archived' };

export interface ProfileRow {
  id: string;
  org_id: string;
  scope: ProfileScope;
  project_id: string | null;
  asset_id: string | null;
  name: string;
  description: string | null;
  originator_name: string | null;
  assessor_name: string | null;
  owner_name: string | null;
  status: ProfileStatus;
  review_interval_months: number;
  made_current_at: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  created_at: string;
}

/** A Perth calendar day from a timestamptz, by arithmetic — the UTC day is a day early before 8 am. */
export function perthDay(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const d = Number(iso.slice(8, 10));
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * When the profile is next due a review: the last review, else the day it was made, plus its interval — the same
 * rule as `app.risk_profile_review_due`; change both together. Null once archived.
 */
export function reviewDue(profile: Pick<ProfileRow, 'status' | 'created_at' | 'review_interval_months'>, lastReviewedOn: string | null): string | null {
  if (profile.status === 'archived') return null;
  const from = lastReviewedOn ?? perthDay(profile.created_at);
  return addMonths(from, profile.review_interval_months);
}

export type ReviewStatus = 'overdue' | 'due_soon' | 'ok' | 'none';
export const REVIEW_DAYS_SOON = 30;
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function reviewStatus(due: string | null, today: string): ReviewStatus {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due <= addDays(today, REVIEW_DAYS_SOON)) return 'due_soon';
  return 'ok';
}

/* ------------------------------------------------------------------------------------------------
   Risks and controls
   ------------------------------------------------------------------------------------------------ */

export interface RiskRow {
  id: string;
  org_id: string;
  profile_id: string;
  seq: number;
  task: string;
  step: string | null;
  hazard: string;
  hazard_type: string | null;
  unwanted_event: string | null;
  inherent_likelihood: Likelihood | null;
  inherent_consequence: Consequence | null;
  inherent_level: RiskLevel;
  residual_likelihood: Likelihood | null;
  residual_consequence: Consequence | null;
  residual_level: RiskLevel | null;
  potential_likelihood: Likelihood | null;
  potential_consequence: Consequence | null;
  potential_level: RiskLevel | null;
  critical: boolean;
  owner_name: string | null;
  assigned_to: string | null;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_reason: string | null;
  source_swms_id: string | null;
  source_step: number | null;
  notes: string | null;
  created_at: string;
}

export type ControlKind = 'existing' | 'planned';
export const CONTROL_KIND_LABEL: Record<ControlKind, string> = { existing: 'Existing', planned: 'Planned' };
export type RiskControlStatus = 'planned' | 'in_place' | 'withdrawn';
export const RISK_CONTROL_STATUS_LABEL: Record<RiskControlStatus, string> = { planned: 'Planned', in_place: 'In place', withdrawn: 'Withdrawn' };

export interface ControlRow {
  id: string;
  risk_id: string;
  description: string;
  level: ControlLevel | null;
  kind: ControlKind;
  critical: boolean;
  status: RiskControlStatus;
  due_on: string | null;
  priority: 'normal' | 'high' | 'critical';
  owner_name: string | null;
  assigned_to: string | null;
  in_place_at: string | null;
  in_place_note: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
}

export function riskRef(seq: number): string {
  return `RSK-${String(seq).padStart(3, '0')}`;
}

/** The three ratings as the register prints them: the level, and the pair behind it where one was given. */
export function ratingText(level: RiskLevel | null, likelihood: Likelihood | null, consequence: Consequence | null): string {
  if (!level) return '—';
  const pair = likelihood && consequence ? ` (${LIKELIHOOD_LABEL[likelihood]} · ${CONSEQUENCE_LABEL[consequence]})` : '';
  return `${RISK_LABEL[level]}${pair}`;
}

/** What is wrong with a risk before it is saved — the screen's half of `app.risks_before_write`. */
export function riskProblems(r: Pick<RiskRow, 'task' | 'hazard' | 'inherent_likelihood' | 'inherent_consequence' | 'inherent_level' | 'residual_likelihood' | 'residual_consequence' | 'potential_likelihood' | 'potential_consequence'>): string[] {
  const out: string[] = [];
  if (!r.task.trim()) out.push('Name the task.');
  if (!r.hazard.trim()) out.push('Name the hazard.');
  if ((r.inherent_likelihood == null) !== (r.inherent_consequence == null)) out.push('The inherent rating needs both its likelihood and its consequence.');
  if (r.inherent_likelihood == null && !r.inherent_level) out.push('Rate the inherent risk — a likelihood and a consequence, or a level.');
  if ((r.residual_likelihood == null) !== (r.residual_consequence == null)) out.push('The residual rating needs both its likelihood and its consequence.');
  if ((r.potential_likelihood == null) !== (r.potential_consequence == null)) out.push('The potential rating needs both its likelihood and its consequence.');
  return out;
}

export type RiskControlState = 'no_controls' | 'planned_only' | 'controlled';
export const RISK_CONTROL_STATE_LABEL: Record<RiskControlState, string> = { no_controls: 'No controls', planned_only: 'Controls planned, none in place', controlled: 'Controlled' };

/** Whether anything stands between the hazard and the event today: withdrawn controls do not count. */
export function riskControlState(controls: ReadonlyArray<Pick<ControlRow, 'status'>>): RiskControlState {
  const live = controls.filter((c) => c.status !== 'withdrawn');
  if (live.length === 0) return 'no_controls';
  return live.some((c) => c.status === 'in_place') ? 'controlled' : 'planned_only';
}

/** The highest rung of the hierarchy among the controls in place, or null. */
export function bestControlInPlace(controls: ReadonlyArray<Pick<ControlRow, 'status' | 'level'>>): ControlLevel | null {
  let best: ControlLevel | null = null;
  for (const c of controls) {
    if (c.status !== 'in_place' || !c.level) continue;
    if (!best || CONTROL_LEVEL_RANK[c.level] < CONTROL_LEVEL_RANK[best]) best = c.level;
  }
  return best;
}

/** The register's order: open before closed, then the worst residual (else inherent) first, then by number. */
export function sortRisks<T extends Pick<RiskRow, 'status' | 'inherent_level' | 'residual_level' | 'seq'>>(rows: readonly T[]): T[] {
  const worst = (r: T) => LEVEL_RANK[r.residual_level ?? r.inherent_level];
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    const w = worst(b) - worst(a);
    if (w !== 0) return w;
    return a.seq - b.seq;
  });
}

/* ------------------------------------------------------------------------------------------------
   The dashboard
   ------------------------------------------------------------------------------------------------ */

export interface LevelCounts { low: number; medium: number; high: number; extreme: number }
export interface RiskSummary {
  open: number;
  closed: number;
  critical: number;
  /** Open risks with no control in place. */
  uncontrolled: number;
  criticalUncontrolled: number;
  /** Open risks rated high or extreme on their residual (else inherent) rating. */
  highResidual: number;
  /** Average likelihood × consequence over the open risks that carry the pair; null when none do. */
  averages: { inherent: number | null; residual: number | null; potential: number | null };
  /** Counts of open risks by level, one set per rating; a rating not given is not counted. */
  levels: { inherent: LevelCounts; residual: LevelCounts; potential: LevelCounts };
  /** Planned controls not yet in place, and how many of those are past due. */
  controlsPlanned: number;
  controlsOverdue: number;
}

const zero = (): LevelCounts => ({ low: 0, medium: 0, high: 0, extreme: 0 });
function average(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

/** The one arithmetic for the gauges: the profile page, the register page, Safety and the home card all call this. */
export function summariseRisks(risks: readonly RiskRow[], controls: readonly ControlRow[], today: string): RiskSummary {
  const byRisk = new Map<string, ControlRow[]>();
  for (const c of controls) byRisk.set(c.risk_id, [...(byRisk.get(c.risk_id) ?? []), c]);
  const s: RiskSummary = {
    open: 0, closed: 0, critical: 0, uncontrolled: 0, criticalUncontrolled: 0, highResidual: 0,
    averages: { inherent: null, residual: null, potential: null },
    levels: { inherent: zero(), residual: zero(), potential: zero() },
    controlsPlanned: 0, controlsOverdue: 0,
  };
  const inh: number[] = []; const res: number[] = []; const pot: number[] = [];
  for (const r of risks) {
    if (r.status === 'closed') { s.closed += 1; continue; }
    s.open += 1;
    if (r.critical) s.critical += 1;
    const cs = byRisk.get(r.id) ?? [];
    const state = riskControlState(cs);
    if (state !== 'controlled') { s.uncontrolled += 1; if (r.critical) s.criticalUncontrolled += 1; }
    const worst = r.residual_level ?? r.inherent_level;
    if (worst === 'high' || worst === 'extreme') s.highResidual += 1;
    s.levels.inherent[r.inherent_level] += 1;
    if (r.residual_level) s.levels.residual[r.residual_level] += 1;
    if (r.potential_level) s.levels.potential[r.potential_level] += 1;
    const a = riskScore(r.inherent_likelihood, r.inherent_consequence); if (a != null) inh.push(a);
    const b = riskScore(r.residual_likelihood, r.residual_consequence); if (b != null) res.push(b);
    const c = riskScore(r.potential_likelihood, r.potential_consequence); if (c != null) pot.push(c);
    for (const ctl of cs) {
      if (ctl.kind !== 'planned' || ctl.status !== 'planned') continue;
      s.controlsPlanned += 1;
      if (ctl.due_on && ctl.due_on < today) s.controlsOverdue += 1;
    }
  }
  s.averages = { inherent: average(inh), residual: average(res), potential: average(pot) };
  return s;
}

/** Where an average of 1–25 sits on the gauge: the level the pair nearest that score rates at on the default matrix. */
export function gaugeLevel(score: number | null): RiskLevel | null {
  if (score == null) return null;
  if (score >= 15) return 'extreme';
  if (score >= 8) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/* ------------------------------------------------------------------------------------------------
   The SWMS feed
   ------------------------------------------------------------------------------------------------ */

export interface SwmsStepFacts { step: string; hazards: string; risk_before: RiskLevel | null; controls: string; risk_after: RiskLevel | null }

export interface ProposedRisk {
  task: string;
  step: string | null;
  hazard: string;
  inherent_level: RiskLevel;
  residual_level: RiskLevel | null;
  /** One existing control, its level unclassed, from the step's control text verbatim; none when the step says nothing. */
  control: string | null;
  source_step: number;
}

/**
 * What an active SWMS says, as risks for a profile (README R187): one per step, the step's "before" level as the
 * inherent, "after" as the residual — levels only, because a SWMS step carries no likelihood and consequence — and
 * its controls as one existing control in the SWMS's own words. A step already on the profile (by SWMS and step
 * number) is skipped; a step with no hazard written is skipped too, because a risk needs its hazard. Nothing is
 * invented: a step with no rating is left out and the screen says so.
 */
export function proposeFromSwms(title: string, steps: readonly SwmsStepFacts[], already: ReadonlyArray<Pick<RiskRow, 'source_step'>>): { risks: ProposedRisk[]; skipped: number } {
  const have = new Set(already.map((r) => r.source_step));
  const risks: ProposedRisk[] = [];
  let skipped = 0;
  steps.forEach((s, i) => {
    const n = i + 1;
    if (have.has(n)) return;
    if (!s.hazards.trim() || !s.risk_before) { skipped += 1; return; }
    risks.push({
      task: title.trim(),
      step: s.step.trim() || null,
      hazard: s.hazards.trim(),
      inherent_level: s.risk_before,
      residual_level: s.risk_after,
      control: s.controls.trim() || null,
      source_step: n,
    });
  });
  return { risks, skipped };
}

/* ------------------------------------------------------------------------------------------------
   Who assesses
   ------------------------------------------------------------------------------------------------ */

/**
 * The TS half of `app.can_assess_risk`: a job's profile is written by the job's supervisor, PM or admin
 * (`app.can_write_swms`); the company's and an asset's by the office (PM or admin). The leading hand reads.
 */
export function canAssess(role: string, scope: ProfileScope): boolean {
  if (scope === 'project') return role === 'supervisor' || role === 'pm' || role === 'admin';
  return role === 'pm' || role === 'admin';
}
