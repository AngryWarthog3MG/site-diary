/**
 * Construction work records as facts: trench controls, whether services
 * information is still current, and who on the crew holds no white card.
 *
 * WHS (General) Regulations 2022 (WA) Chapter 6. Pure and dependency-free.
 */

/** reg. 306: a trench at least this deep is secured against collapse. */
export const TRENCH_CONTROL_DEPTH_M = 1.5;

export const TRENCH_CONTROLS = ['benching', 'battering', 'shoring', 'engineer_advice'] as const;
export type TrenchControl = (typeof TRENCH_CONTROLS)[number];
export const TRENCH_CONTROL_LABEL: Record<TrenchControl, string> = {
  benching: 'Benching',
  battering: 'Battering',
  shoring: 'Shoring',
  engineer_advice: 'Geotechnical engineer advised in writing it is not at risk of collapse',
};

/** Whether reg. 306 requires a control at this depth. An unknown depth requires nothing it can be shown to need. */
export function trenchNeedsControl(depthM: number | null): boolean {
  return depthM != null && depthM >= TRENCH_CONTROL_DEPTH_M;
}

/**
 * Whether the answers for a trench satisfy reg. 306. Mirrors the database
 * constraints, so the form says what is missing before the save refuses it.
 */
export function trenchProblem(depthM: number | null, control: TrenchControl | null, engineerRef: string | null): string | null {
  if (trenchNeedsControl(depthM) && control == null) {
    return `A trench ${TRENCH_CONTROL_DEPTH_M} m deep or more is benched, battered or shored, or a geotechnical engineer has advised in writing (reg. 306).`;
  }
  if (control === 'engineer_advice' && !(engineerRef ?? '').trim()) {
    return "Give the reference of the engineer's written advice.";
  }
  return null;
}

export type InfoCurrency = 'current' | 'expired' | 'no_expiry_stated';

/** Whether the services information is still current, by the date it was said to be valid until. Nothing is assumed. */
export function servicesInfoCurrency(validUntil: string | null, today: string): InfoCurrency {
  if (validUntil == null) return 'no_expiry_stated';
  return validUntil < today ? 'expired' : 'current';
}

export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The people on the crew list with no active, unexpired white card recorded
 * (reg. 317). A white card does not expire in WA, so a card with no expiry is
 * a card; one with an expiry in the past is not.
 */
export function withoutWhiteCard(
  crew: readonly string[],
  tickets: ReadonlyArray<{ person_name: string; ticket_type: string; active: boolean; expires_on: string | null }>,
  today: string,
): string[] {
  const holders = new Set(
    tickets
      .filter((t) => t.ticket_type === 'white_card' && t.active && (t.expires_on == null || t.expires_on >= today))
      .map((t) => normaliseName(t.person_name)),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of crew) {
    const key = normaliseName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!holders.has(key)) out.push(name.trim());
  }
  return out;
}
