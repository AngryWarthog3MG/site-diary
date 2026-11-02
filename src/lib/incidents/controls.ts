/**
 * Hazard controls (README R179): the hierarchy of controls, the state a hazard is in — read off its controls,
 * never typed — and the built-in hazard types the company's own join. The database holds the same state rule
 * (`public.hazard_control_state`); this is the screen's half. Pure and dependency-free.
 */

export const CONTROL_LEVELS = ['elimination', 'substitution', 'isolation', 'engineering', 'administrative', 'ppe'] as const;
export type ControlLevel = (typeof CONTROL_LEVELS)[number];
export const CONTROL_LEVEL_LABEL: Record<ControlLevel, string> = {
  elimination: 'Elimination — remove the hazard',
  substitution: 'Substitution — swap for something safer',
  isolation: 'Isolation — keep people away from it',
  engineering: 'Engineering — guards, barriers, ventilation',
  administrative: 'Administrative — procedures, training, signs, spotters',
  ppe: 'PPE — last line',
};
export const CONTROL_LEVEL_SHORT: Record<ControlLevel, string> = {
  elimination: 'Elimination', substitution: 'Substitution', isolation: 'Isolation', engineering: 'Engineering', administrative: 'Administrative', ppe: 'PPE',
};
/** Higher is better on the hierarchy: 0 = elimination … 5 = PPE. */
export const CONTROL_LEVEL_RANK: Record<ControlLevel, number> = { elimination: 0, substitution: 1, isolation: 2, engineering: 3, administrative: 4, ppe: 5 };

export type ControlStatus = 'planned' | 'in_place' | 'withdrawn';
export const CONTROL_STATUS_LABEL: Record<ControlStatus, string> = { planned: 'Planned', in_place: 'In place', withdrawn: 'Withdrawn' };

export interface ControlFacts { level: ControlLevel; status: ControlStatus }

export type ControlState = 'no_controls' | 'control_pending' | 'controlled' | 'eliminated';
export const CONTROL_STATE_LABEL: Record<ControlState, string> = {
  no_controls: 'No controls', control_pending: 'Control pending', controlled: 'Controlled', eliminated: 'Eliminated',
};

/** The SQL twin is `public.hazard_control_state`; change both together. */
export function controlState(controls: readonly ControlFacts[]): ControlState {
  if (controls.some((c) => c.status === 'in_place' && c.level === 'elimination')) return 'eliminated';
  if (controls.some((c) => c.status === 'in_place')) return 'controlled';
  if (controls.some((c) => c.status === 'planned')) return 'control_pending';
  return 'no_controls';
}

/** The best level in place, for "controlled at engineering level" on a card; null when nothing is in. */
export function bestLevelInPlace(controls: readonly ControlFacts[]): ControlLevel | null {
  const inPlace = controls.filter((c) => c.status === 'in_place');
  if (inPlace.length === 0) return null;
  return inPlace.reduce((best, c) => (CONTROL_LEVEL_RANK[c.level] < CONTROL_LEVEL_RANK[best] ? c.level : best), inPlace[0].level);
}

/** Controls in the order they read on a sheet: in place first, best level first, then planned, then withdrawn. */
export function sortControls<T extends ControlFacts & { created_at: string }>(controls: readonly T[]): T[] {
  const order: Record<ControlStatus, number> = { in_place: 0, planned: 1, withdrawn: 2 };
  return [...controls].sort((a, b) => order[a.status] - order[b.status] || CONTROL_LEVEL_RANK[a.level] - CONTROL_LEVEL_RANK[b.level] || a.created_at.localeCompare(b.created_at));
}

/** The built-in hazard types; the company's own join them on `org_incident_causes` kind `hazard_type`. */
export const BUILT_IN_HAZARD_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'excavation', label: 'Excavation and trenches' },
  { key: 'mobile_plant', label: 'Mobile plant and vehicles' },
  { key: 'traffic', label: 'Traffic and public interface' },
  { key: 'services', label: 'Underground or overhead services' },
  { key: 'heights', label: 'Working at heights' },
  { key: 'lifting', label: 'Lifting and cranes' },
  { key: 'manual_handling', label: 'Manual handling' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'hazardous_substances', label: 'Hazardous substances and dust' },
  { key: 'noise_vibration', label: 'Noise and vibration' },
  { key: 'heat_weather', label: 'Heat, UV and weather' },
  { key: 'confined_space', label: 'Confined space' },
  { key: 'slips_trips', label: 'Slips, trips and housekeeping' },
  { key: 'environmental', label: 'Environmental — spill, erosion, fauna' },
  { key: 'other', label: 'Other' },
];

export interface HazardTypeOption { key: string; label: string; custom: boolean; retired?: boolean }

export function hazardTypeOptions(custom: ReadonlyArray<{ kind: string; key: string; label: string; active?: boolean }>): HazardTypeOption[] {
  const fixed = BUILT_IN_HAZARD_TYPES.map((t) => ({ key: t.key, label: t.label, custom: false }));
  const taken = new Set(fixed.map((f) => f.key));
  const own = custom.filter((c) => c.kind === 'hazard_type' && !taken.has(c.key)).map((c) => ({ key: c.key, label: c.active === false ? `${c.label} (retired)` : c.label, custom: true, retired: c.active === false }));
  return [...fixed, ...own];
}

export function hazardTypeLabel(key: string | null, custom: ReadonlyArray<{ kind: string; key: string; label: string }> = []): string | null {
  if (!key) return null;
  return BUILT_IN_HAZARD_TYPES.find((t) => t.key === key)?.label ?? custom.find((c) => c.kind === 'hazard_type' && c.key === key)?.label ?? key;
}

export interface HazardRow { kind: string; status: string; critical_risk: boolean; controls: readonly ControlFacts[] }

/** The counts a register and the safety dashboard show — the same arithmetic in both. */
export function summariseHazards(rows: readonly HazardRow[]): { open: number; uncontrolled: number; critical: number; criticalUncontrolled: number } {
  const open = rows.filter((r) => r.kind === 'hazard' && r.status !== 'closed');
  const uncontrolled = open.filter((r) => { const s = controlState(r.controls); return s === 'no_controls' || s === 'control_pending'; });
  return { open: open.length, uncontrolled: uncontrolled.length, critical: open.filter((r) => r.critical_risk).length, criticalUncontrolled: uncontrolled.filter((r) => r.critical_risk).length };
}
