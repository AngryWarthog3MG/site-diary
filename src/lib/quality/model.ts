/**
 * Quality records as facts: ITP points, lot checks, hold point releases,
 * non-conformance and calibration.
 *
 * The rules here mirror the database (migrations 20260916190000 and
 * 20260916190100) so a screen can say what is missing before a save is
 * refused. If the two ever disagree, the database wins. Pure and
 * dependency-free.
 */

export const POINT_TYPES = ['hold', 'witness', 'surveillance', 'record'] as const;
export type PointType = (typeof POINT_TYPES)[number];
export const POINT_TYPE_LABEL: Record<PointType, string> = {
  hold: 'Hold point',
  witness: 'Witness point',
  surveillance: 'Surveillance',
  record: 'Record review',
};

export const RESULTS = ['conforms', 'does_not_conform', 'na'] as const;
export type Result = (typeof RESULTS)[number];
export const RESULT_LABEL: Record<Result, string> = { conforms: 'Conforms', does_not_conform: 'Does not conform', na: 'Not applicable' };

export const DISPOSITIONS = ['rework', 'repair', 'use_as_is', 'reject'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const DISPOSITION_LABEL: Record<Disposition, string> = {
  rework: 'Rework — into a new, re-numbered lot',
  repair: 'Repair in place and re-test',
  use_as_is: 'Use as is (concession)',
  reject: 'Reject and remove',
};

export type LotStatus = 'open' | 'nonconforming' | 'conforming' | 'replaced';
export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  open: 'Open', nonconforming: 'On hold — non-conforming', conforming: 'Closed — conforming', replaced: 'Replaced by a rework lot',
};

export type NcrStatus = 'open' | 'approved' | 'closed';
export const NCR_STATUS_LABEL: Record<NcrStatus, string> = {
  open: 'Open — disposition not yet approved', approved: 'Disposition approved — to close out', closed: 'Closed',
};

const pad = (n: number) => String(n).padStart(3, '0');
export const lotRef = (seq: number) => `LOT-${pad(seq)}`;
export const ncrRef = (seq: number) => `NCR-${pad(seq)}`;
export const itpRef = (code: string, revision: number) => `${code} rev ${revision}`;

export interface PointFacts {
  id: string;
  seq: number;
  inspection_test: string;
  point_type: PointType;
  uses_calibrated_equipment: boolean;
}

export interface CheckFacts {
  itp_point_id: string;
  result: Result;
  created_at: string;
}

export interface NcrFacts {
  itp_point_id: string | null;
  status: NcrStatus;
  disposition: Disposition | null;
}

/** The latest check against each point, by when it was recorded. */
export function latestChecks<T extends CheckFacts>(checks: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const c of checks) {
    const prev = out.get(c.itp_point_id);
    if (!prev || c.created_at > prev.created_at) out.set(c.itp_point_id, c);
  }
  return out;
}

/** What stands between a lot and closing it as conforming. Mirrors app.lot_close_problems. */
export function lotCloseProblems(
  points: readonly PointFacts[],
  checks: readonly CheckFacts[],
  releasedPointIds: ReadonlySet<string>,
  ncrs: readonly NcrFacts[],
): string[] {
  const out: string[] = [];
  if (ncrs.some((n) => n.status !== 'closed')) out.push('A non-conformance on this lot is not closed.');
  const latest = latestChecks(checks);
  for (const pt of [...points].sort((a, b) => a.seq - b.seq)) {
    const c = latest.get(pt.id);
    if (!c) {
      out.push(`Point ${pt.seq} (${pt.inspection_test}) has no result.`);
    } else if (c.result === 'does_not_conform'
      && !ncrs.some((n) => n.itp_point_id === pt.id && n.status === 'closed' && n.disposition === 'use_as_is')) {
      out.push(`Point ${pt.seq} (${pt.inspection_test}) does not conform.`);
    }
    if (pt.point_type === 'hold' && !releasedPointIds.has(pt.id)) {
      out.push(`Hold point ${pt.seq} (${pt.inspection_test}) is not released.`);
    }
  }
  return out;
}

/** Hold points whose check conforms but which nobody has released: work stopped, waiting on a signature. */
export function holdsAwaitingRelease<T extends PointFacts>(points: readonly T[], checks: readonly CheckFacts[], releasedPointIds: ReadonlySet<string>): T[] {
  const latest = latestChecks(checks);
  return points.filter((p) => p.point_type === 'hold' && !releasedPointIds.has(p.id) && latest.get(p.id)?.result === 'conforms');
}

/** Whether further testing is allowed on a lot. Mirrors the check trigger and cl. 201.06.04. */
export function testingAllowed(status: LotStatus, ncrs: readonly NcrFacts[]): boolean {
  if (status === 'conforming' || status === 'replaced') return false;
  if (status === 'open') return true;
  return ncrs.length > 0 && ncrs.every((n) => n.status !== 'open');
}

export type ReportState = 'no_clock' | 'reported' | 'due' | 'overdue';

/**
 * Whether a non-conformance was reported to the principal in time. The clock is
 * the contract's, set per job; with none set there is nothing to be late for.
 */
export function ncrReportState(detectedAt: string, reportedAt: string | null, hours: number | null, now: string): { state: ReportState; dueAt: string | null } {
  if (hours == null) return { state: reportedAt ? 'reported' : 'no_clock', dueAt: null };
  const dueAt = new Date(Date.parse(detectedAt) + hours * 3_600_000).toISOString();
  if (reportedAt) return { state: 'reported', dueAt };
  return { state: Date.parse(now) > Date.parse(dueAt) ? 'overdue' : 'due', dueAt };
}

export interface CalibrationFacts {
  calibrated_on: string;
  due_on: string;
  certificate_no: string;
}

export type CalibrationStatus = 'none' | 'expired' | 'due_soon' | 'current';
export const CALIBRATION_LABEL: Record<CalibrationStatus, string> = {
  none: 'No calibration recorded', expired: 'Out of calibration', due_soon: 'Calibration due soon', current: 'In calibration',
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The calibration that runs latest, and the equipment's status today. */
export function calibrationStatus(cals: readonly CalibrationFacts[], today: string, warnDays = 30): { status: CalibrationStatus; latest: CalibrationFacts | null } {
  if (cals.length === 0) return { status: 'none', latest: null };
  const latest = cals.reduce((a, b) => (a.due_on >= b.due_on ? a : b));
  if (latest.due_on < today) return { status: 'expired', latest };
  if (latest.due_on <= addDays(today, warnDays)) return { status: 'due_soon', latest };
  return { status: 'current', latest };
}

/** Whether equipment was in calibration on a day. Mirrors app.equipment_calibrated_on. */
export function calibratedOn(cals: readonly CalibrationFacts[], day: string): boolean {
  return cals.some((c) => c.calibrated_on <= day && c.due_on >= day);
}

export interface DraftPoint {
  activity: string;
  inspection_test: string;
  acceptance_criteria: string;
  frequency: string;
  responsible: string;
  point_type: PointType | '';
}

/**
 * What a point still needs, by the elements Main Roads WA Spec 201 cl.
 * 201.06.02 requires: the process and the test, who, how often, the criteria,
 * and whether it is a hold or witness point.
 */
export function pointProblems(p: DraftPoint): string[] {
  const out: string[] = [];
  if (!p.activity.trim()) out.push('the work process');
  if (!p.inspection_test.trim()) out.push('what is inspected or tested');
  if (!p.acceptance_criteria.trim()) out.push('the acceptance criteria');
  if (!p.frequency.trim()) out.push('how often');
  if (!p.responsible.trim()) out.push('who is responsible');
  if (!p.point_type) out.push('the kind of point');
  return out;
}
