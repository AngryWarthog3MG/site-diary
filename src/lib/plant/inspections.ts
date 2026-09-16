/**
 * When a machine is next due for inspection, and whether it may be used.
 *
 * WHS (General) Regulations 2022 (WA) reg. 213 sets the interval as a cascade:
 * the manufacturer's recommendation; failing that a competent person's; and,
 * for inspection only, failing both, annually. WHS Act 2020 (WA) s. 42 forbids
 * using plant that must be registered and is not.
 *
 * Pure and dependency-free, so the machine page, the plant check form and
 * What's due all reach the same answer.
 */
import { addMonths } from '../obligations/model.ts';

export const INSPECTION_BASES = ['manufacturer', 'competent_person', 'annual'] as const;
export type InspectionBasis = (typeof INSPECTION_BASES)[number];

export const BASIS_LABEL: Record<InspectionBasis, string> = {
  manufacturer: "The manufacturer's recommendation",
  competent_person: "A competent person's recommendation",
  annual: 'Annually — no recommendation available (inspection only)',
};

export const RECORD_KINDS = ['inspection', 'test', 'maintenance', 'commissioning', 'decommissioning', 'dismantling', 'alteration'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  inspection: 'Inspection', test: 'Test', maintenance: 'Maintenance', commissioning: 'Commissioning',
  decommissioning: 'Decommissioning', dismantling: 'Dismantling', alteration: 'Alteration',
};

export const OUTCOMES = ['pass', 'pass_with_actions', 'fail'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = { pass: 'Pass', pass_with_actions: 'Pass, with actions', fail: 'Fail' };

export interface PlantFacts {
  inspection_basis: InspectionBasis | null;
  inspection_interval_months: number | null;
  registration_required: boolean;
  registration_no: string | null;
  registration_expires_on: string | null;
}

export interface RecordFacts {
  kind: RecordKind;
  done_on: string;
  next_due_on: string | null;
  outcome: Outcome | null;
}

/** An inspection or a test is what discharges the reg. 213 interval; maintenance alone does not. */
export function isInspection(kind: RecordKind): boolean {
  return kind === 'inspection' || kind === 'test';
}

export function lastInspection<T extends RecordFacts>(records: readonly T[]): T | null {
  const of = records.filter((r) => isInspection(r.kind));
  if (of.length === 0) return null;
  return of.reduce((a, b) => (a.done_on >= b.done_on ? a : b));
}

/**
 * The interval in months, per the cascade. Annual applies only when that is
 * the basis chosen and no interval was given; a manufacturer or competent
 * person basis with no interval stated has no due date to invent.
 */
export function intervalMonths(plant: PlantFacts): number | null {
  if (plant.inspection_interval_months != null) return plant.inspection_interval_months;
  if (plant.inspection_basis === 'annual') return 12;
  return null;
}

export type InspectionState =
  | { state: 'not_scheduled' }
  | { state: 'never_inspected'; due: null }
  | { state: 'scheduled'; due: string; from: 'inspector' | 'interval' };

/**
 * When the next inspection falls due. A date the inspector wrote on the last
 * one wins; otherwise the interval counts from the last inspection. A machine
 * with a basis but no inspection on record is due now — it cannot be shown to
 * have been inspected at all.
 */
export function nextInspection(plant: PlantFacts, records: readonly RecordFacts[]): InspectionState {
  if (plant.inspection_basis == null && plant.inspection_interval_months == null) return { state: 'not_scheduled' };
  const last = lastInspection(records);
  if (!last) return { state: 'never_inspected', due: null };
  if (last.next_due_on) return { state: 'scheduled', due: last.next_due_on, from: 'inspector' };
  const months = intervalMonths(plant);
  if (months == null) return { state: 'not_scheduled' };
  return { state: 'scheduled', due: addMonths(last.done_on, months), from: 'interval' };
}

export type RegistrationStatus = 'not_required' | 'missing' | 'expired' | 'expiring' | 'current';

export const REGISTRATION_LABEL: Record<RegistrationStatus, string> = {
  not_required: 'Registration not required',
  missing: 'Registration required — none recorded',
  expired: 'Registration lapsed',
  expiring: 'Registration expiring',
  current: 'Registered',
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function registrationStatus(plant: PlantFacts, today: string, warnDays = 30): RegistrationStatus {
  if (!plant.registration_required) return 'not_required';
  if (!plant.registration_no || !plant.registration_no.trim()) return 'missing';
  if (plant.registration_expires_on == null) return 'current';
  if (plant.registration_expires_on < today) return 'expired';
  if (plant.registration_expires_on <= addDays(today, warnDays)) return 'expiring';
  return 'current';
}

/** WHS Act s. 42: a machine that must be registered and is not may not be used. Mirrors the database trigger. */
export function mayNotBeUsed(status: RegistrationStatus): boolean {
  return status === 'missing' || status === 'expired';
}
