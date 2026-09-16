/**
 * Asbestos records as facts: the register in force, its management plan's
 * five-yearly review, which of the crew have been briefed, and whether a
 * removal was notified in time with the right licence.
 *
 * WHS (General) Regulations 2022 (WA) regs 425, 429, 466. Mirrors the database
 * constraints so the screen says what is wrong before a save is refused. Pure.
 */

export const PLAN_REVIEW_YEARS = 5;
export const REMOVAL_NOTICE_DAYS = 5;
export const NON_FRIABLE_LICENCE_AREA_M2 = 10;

export type RegisterStatus = 'received' | 'own' | 'not_required';
export const REGISTER_STATUS_LABEL: Record<RegisterStatus, string> = {
  received: 'Register received from the duty holder',
  own: 'Our own register — we have management or control',
  not_required: 'No register required',
};

export interface RegisterFacts {
  id: string;
  register_date: string;
  superseded_by: string | null;
  asbestos_present: boolean;
  plan_date: string | null;
}

/** The register in force: the one nothing has superseded, the latest if there are several. */
export function registerInForce<T extends RegisterFacts>(registers: readonly T[]): T | null {
  const live = registers.filter((r) => r.superseded_by == null);
  if (live.length === 0) return null;
  return live.reduce((a, b) => (a.register_date >= b.register_date ? a : b));
}

function addYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const md = iso.slice(4);
  if (md === '-02-29' && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return `${y}-02-28`;
  return `${y}${md}`;
}

/** When the management plan is due for review, if there is one. */
export function planReviewDue(register: RegisterFacts): string | null {
  return register.plan_date ? addYears(register.plan_date, PLAN_REVIEW_YEARS) : null;
}

/** reg. 429: a plan is needed where asbestos is identified or presumed. */
export function needsPlan(register: RegisterFacts): boolean {
  return register.asbestos_present;
}

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The people on the crew list not yet briefed on the register in force. */
export function notBriefed(crew: readonly string[], briefedNames: readonly string[]): string[] {
  const told = new Set(briefedNames.map(norm));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of crew) {
    const k = norm(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (!told.has(k)) out.push(c.trim());
  }
  return out;
}

/** The three limbs of reg. 425's exception, all required. */
export function notRequiredProblem(builtAfter2003: boolean, noneIdentified: boolean, noneLikely: boolean): string | null {
  if (builtAfter2003 && noneIdentified && noneLikely) return null;
  return 'No register is required only when the building was built after 31 December 2003, no asbestos has been identified, and none is likely — all three.';
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** What is wrong with a removal as recorded. Mirrors the database constraints. */
export function removalProblems(r: { friable: boolean; area_m2: number | null; licence_class: 'A' | 'B'; emergency: boolean; notified_worksafe_on: string; work_start_on: string }): string[] {
  const out: string[] = [];
  if (r.friable && r.licence_class !== 'A') out.push('Friable asbestos is removed under a Class A licence.');
  if (!r.emergency && daysBetween(r.notified_worksafe_on, r.work_start_on) < REMOVAL_NOTICE_DAYS) {
    out.push(`WorkSafe is notified at least ${REMOVAL_NOTICE_DAYS} days before the work starts, unless it is an emergency (reg. 466).`);
  }
  return out;
}

/** Whether the removal is licensed work at all: any friable, or more than 10 m² of non-friable. */
export function isLicensedRemoval(friable: boolean, areaM2: number | null): boolean {
  return friable || (areaM2 != null && areaM2 > NON_FRIABLE_LICENCE_AREA_M2);
}
