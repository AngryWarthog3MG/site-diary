/**
 * The method statement as facts: what counts as high-risk construction work,
 * how risk is rated, what a step is, and when a SWMS is complete enough to be
 * worked to. Pure; the database holds the same completeness rule
 * (app.swms_problems) and wins if they disagree.
 */

export type SwmsKind = 'swms' | 'jsa';
export const KIND_LABEL: Record<SwmsKind, string> = { swms: 'SWMS', jsa: 'JSA' };
export const KIND_LONG: Record<SwmsKind, string> = { swms: 'Safe Work Method Statement', jsa: 'Job Safety Analysis' };

/** High-risk construction work, WHS Regulations r.291. The record keeps the text. */
export const HRCW_CATEGORIES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'fall_2m', label: 'Risk of a person falling more than 2 metres' },
  { key: 'telecom_tower', label: 'Work on a telecommunication tower' },
  { key: 'demolition_loadbearing', label: 'Demolition of a load-bearing element' },
  { key: 'asbestos', label: 'Likely to involve disturbing asbestos' },
  { key: 'structural_alteration', label: 'Structural alterations needing temporary support' },
  { key: 'confined_space', label: 'Work in or near a confined space' },
  { key: 'shaft_trench', label: 'Shaft or trench deeper than 1.5 m, or a tunnel' },
  { key: 'explosives', label: 'Use of explosives' },
  { key: 'pressurised_gas', label: 'Work on or near pressurised gas mains or piping' },
  { key: 'chemical_fuel_lines', label: 'Work on or near chemical, fuel or refrigerant lines' },
  { key: 'energised_electrical', label: 'Work on or near energised electrical installations or services' },
  { key: 'contaminated_atmosphere', label: 'Work in an area that may have a contaminated or flammable atmosphere' },
  { key: 'tilt_up_precast', label: 'Tilt-up or precast concrete elements' },
  { key: 'road_traffic', label: 'Work on, in or adjacent to a road, railway or other traffic corridor' },
  { key: 'mobile_plant', label: 'Work in an area with movement of powered mobile plant' },
  { key: 'extreme_temperature', label: 'Work in an area with artificial extremes of temperature' },
  { key: 'water_drowning', label: 'Work in or near water or another liquid with a risk of drowning' },
  { key: 'diving', label: 'Diving work' },
];

export const PPE_OPTIONS: readonly string[] = [
  'Hard hat', 'Safety boots', 'Hi-vis', 'Safety glasses', 'Gloves', 'Hearing protection',
  'Long sleeves and pants', 'Sun protection', 'Dust mask / respirator', 'Harness', 'Face shield', 'Gumboots',
];

export const RISK_LEVELS = ['low', 'medium', 'high', 'extreme'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };

export const LIKELIHOOD = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'] as const;
export const CONSEQUENCE = ['insignificant', 'minor', 'moderate', 'major', 'catastrophic'] as const;

/** A 5×5 matrix, the common Australian civil form. Rows likelihood, columns consequence. */
const MATRIX: RiskLevel[][] = [
  ['low', 'low', 'medium', 'medium', 'high'],
  ['low', 'low', 'medium', 'high', 'high'],
  ['low', 'medium', 'high', 'high', 'extreme'],
  ['medium', 'medium', 'high', 'extreme', 'extreme'],
  ['medium', 'high', 'extreme', 'extreme', 'extreme'],
];
export function riskRating(likelihood: (typeof LIKELIHOOD)[number], consequence: (typeof CONSEQUENCE)[number]): RiskLevel {
  return MATRIX[LIKELIHOOD.indexOf(likelihood)][CONSEQUENCE.indexOf(consequence)];
}

export interface SwmsStep {
  step: string;
  hazards: string;
  risk_before: RiskLevel | null;
  controls: string;
  risk_after: RiskLevel | null;
  who: string | null;
}

export const BLANK_STEP: SwmsStep = { step: '', hazards: '', risk_before: null, controls: '', risk_after: null, who: null };

function asRisk(v: unknown): RiskLevel | null {
  return typeof v === 'string' && (RISK_LEVELS as readonly string[]).includes(v) ? (v as RiskLevel) : null;
}

/** Stored JSON → steps, tolerant of anything older or hand-edited. */
export function readSteps(json: unknown): SwmsStep[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      step: typeof r.step === 'string' ? r.step : '',
      hazards: typeof r.hazards === 'string' ? r.hazards : '',
      risk_before: asRisk(r.risk_before),
      controls: typeof r.controls === 'string' ? r.controls : '',
      risk_after: asRisk(r.risk_after),
      who: typeof r.who === 'string' && r.who.trim() ? r.who : null,
    };
  });
}

export interface SwmsFacts {
  kind: SwmsKind;
  hrcw: string[];
  prepared_by: string | null;
  steps: SwmsStep[];
}

/** What stops a draft being put into use. Mirrors app.swms_problems. */
export function swmsProblems(s: SwmsFacts): string[] {
  const problems: string[] = [];
  if (s.steps.length === 0) problems.push('no steps');
  s.steps.forEach((st, i) => {
    if (!st.step.trim()) problems.push(`step ${i + 1} has no description`);
    if (!st.hazards.trim()) problems.push(`step ${i + 1} names no hazard`);
    if (!st.controls.trim()) problems.push(`step ${i + 1} has no control`);
  });
  if (s.kind === 'swms' && s.hrcw.length === 0) problems.push('a SWMS must name its high-risk construction work');
  if (!s.prepared_by?.trim()) problems.push('nobody is named as having prepared it');
  return problems;
}

/** Soft warnings: things a reviewer would question but the law does not forbid. */
export function swmsWarnings(s: SwmsFacts): string[] {
  const out: string[] = [];
  s.steps.forEach((st, i) => {
    if (st.risk_before && st.risk_after && RISK_LEVELS.indexOf(st.risk_after) > RISK_LEVELS.indexOf(st.risk_before)) {
      out.push(`step ${i + 1}: the risk after controls is rated higher than before`);
    }
    if (st.risk_after === 'extreme') out.push(`step ${i + 1}: extreme risk remains after controls — should this work go ahead?`);
  });
  return out;
}

export function hrcwLabel(key: string): string {
  return HRCW_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
