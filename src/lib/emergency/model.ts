/**
 * The emergency plan for a workplace, and when its procedures are next due to
 * be tested. Pure; the screen, the home and What's due all read it the same way.
 *
 * WHS (General) Regulations 2022 (WA) reg. 43(1)(b) requires the plan to
 * provide for "testing of the emergency procedures, including the frequency of
 * testing". The plan states that frequency; the next drill is due that many
 * months after the last one — or after the plan was issued, if there has been
 * none — counted the same way as every other schedule (README R61).
 */
import { addMonths } from '../obligations/model.ts';

export interface PlanFacts {
  id: string;
  version: number;
  issued_at: string;
  test_every_months: number;
}

export interface DrillFacts {
  id: string;
  plan_id: string;
  held_on: string;
}

/** The plan in force: the highest version. Older versions stay, for the day someone asks what was in force. */
export function currentPlan<T extends PlanFacts>(plans: readonly T[]): T | null {
  if (plans.length === 0) return null;
  return plans.reduce((a, b) => (a.version >= b.version ? a : b));
}

/** The Perth calendar day of an instant, by hand. Perth has no daylight saving. */
export function perthDayOf(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function lastDrill<T extends DrillFacts>(drills: readonly T[]): T | null {
  if (drills.length === 0) return null;
  return drills.reduce((a, b) => (a.held_on >= b.held_on ? a : b));
}

/**
 * When the procedures are next due to be tested. Counted from the last drill
 * on this workplace, whichever version it tested — a new version of the plan
 * does not reset the clock, or reissuing the plan would become a way to put
 * a drill off.
 */
export function nextDrillDue(plan: PlanFacts, drills: readonly DrillFacts[]): string {
  const last = lastDrill(drills);
  const from = last ? last.held_on : perthDayOf(plan.issued_at);
  return addMonths(from, plan.test_every_months);
}
