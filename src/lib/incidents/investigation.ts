/**
 * The investigation behind a report (README R178): the built-in cause lists the company's own join, what an
 * investigation must say before it finishes, and how it reads on a screen. The database holds the same rules
 * (`app.incident_investigations_before_write`); this is the half that gives the screen its amber before the
 * save. Pure and dependency-free so it runs under plain Node.
 */

export type CauseKind = 'root_cause' | 'contributing_factor';
export const CAUSE_KIND_LABEL: Record<CauseKind, string> = { root_cause: 'Root causes', contributing_factor: 'Contributing factors' };

export interface CauseOption { key: string; label: string; custom: boolean; retired?: boolean }

/** The built-in root causes — the organisational and system failures an ICAM-style analysis lands on. */
export const BUILT_IN_ROOT_CAUSES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'no_procedure', label: 'No procedure, or the procedure did not cover it' },
  { key: 'procedure_not_followed', label: 'Procedure not followed' },
  { key: 'risk_not_assessed', label: 'Risk not assessed, or the SWMS did not cover the task' },
  { key: 'training_competence', label: 'Training or competence' },
  { key: 'supervision', label: 'Supervision' },
  { key: 'communication', label: 'Communication — instructions, handover, signals' },
  { key: 'plant_equipment', label: 'Plant or equipment — design, condition, selection' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'design_layout', label: 'Design or layout of the work area' },
  { key: 'planning_resourcing', label: 'Planning or resourcing — time, people, materials' },
  { key: 'change_management', label: 'Change not managed' },
  { key: 'contractor_management', label: 'Contractor or subcontractor management' },
];

/** The built-in contributing factors — the conditions and acts around the event. */
export const BUILT_IN_FACTORS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'fatigue', label: 'Fatigue' },
  { key: 'time_pressure', label: 'Time pressure' },
  { key: 'weather_light', label: 'Weather, heat, light or visibility' },
  { key: 'housekeeping', label: 'Housekeeping or ground conditions' },
  { key: 'ppe', label: 'PPE not worn, wrong or unavailable' },
  { key: 'distraction', label: 'Distraction or inattention' },
  { key: 'shortcut', label: 'Shortcut or improvisation' },
  { key: 'unfamiliar_task', label: 'Unfamiliar task or first time on the job' },
  { key: 'inadequate_controls', label: 'Controls absent, failed or bypassed' },
  { key: 'other_parties', label: 'Other parties on site — public, other contractors, traffic' },
];

/** Built-in first, then the company's own; a retired one stays (marked) so a record that names it still reads. */
export function causeOptions(kind: CauseKind, custom: ReadonlyArray<{ kind: CauseKind; key: string; label: string; active?: boolean }>): CauseOption[] {
  const fixed = (kind === 'root_cause' ? BUILT_IN_ROOT_CAUSES : BUILT_IN_FACTORS).map((c) => ({ key: c.key, label: c.label, custom: false }));
  const own = custom.filter((c) => c.kind === kind).map((c) => ({ key: c.key, label: c.active === false ? `${c.label} (retired)` : c.label, custom: true, retired: c.active === false }));
  const taken = new Set(fixed.map((f) => f.key));
  return [...fixed, ...own.filter((c) => !taken.has(c.key))];
}

export type InvestigationStatus = 'open' | 'finished' | 'signed_off';
export const INVESTIGATION_STATUS_LABEL: Record<InvestigationStatus, string> = { open: 'Open', finished: 'Finished — awaiting sign-off', signed_off: 'Signed off' };

export interface InvestigationFacts {
  status: InvestigationStatus;
  due_on: string | null;
  summary: string | null;
  findings: string | null;
}

/** What is still missing before it can finish — the TS half of the DB's check; the DB wins. */
export function finishProblems(v: Pick<InvestigationFacts, 'summary' | 'findings'>, causes: ReadonlyArray<{ kind: CauseKind }>): string[] {
  const out: string[] = [];
  if (!v.summary?.trim()) out.push('a summary of what happened');
  if (!v.findings?.trim()) out.push('the findings');
  if (!causes.some((c) => c.kind === 'root_cause')) out.push('at least one root cause');
  return out;
}

export type InvestigationDue = 'overdue' | 'due_soon' | 'on_track' | 'no_date' | 'done';
export const DUE_SOON_DAYS = 3;

/** Where the investigation stands against its due date; a finished or signed-off one is done with the clock. */
export function investigationDue(v: Pick<InvestigationFacts, 'status' | 'due_on'>, today: string): InvestigationDue {
  if (v.status !== 'open') return 'done';
  if (!v.due_on) return 'no_date';
  if (v.due_on < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + DUE_SOON_DAYS);
  return v.due_on <= soon.toISOString().slice(0, 10) ? 'due_soon' : 'on_track';
}

/**
 * Whether a report is one the company would normally investigate — a prompt on the screen, never a rule:
 * an injury, a notifiable event, or anything whose actual or potential severity is high or extreme.
 */
export function investigationExpected(r: { kind: string; notifiable: boolean; actual_severity: string | null; potential_severity: string | null }): boolean {
  return r.notifiable || r.kind === 'injury' || r.actual_severity === 'high' || r.actual_severity === 'extreme' || r.potential_severity === 'high' || r.potential_severity === 'extreme';
}

/** The five whys as they print: numbered, in order, a gap in the numbering left as a gap. */
export function orderWhys<T extends { seq: number }>(whys: readonly T[]): T[] {
  return [...whys].sort((a, b) => a.seq - b.seq);
}

export function nextWhySeq(whys: ReadonlyArray<{ seq: number }>): number {
  return whys.reduce((n, w) => Math.max(n, w.seq), 0) + 1;
}
