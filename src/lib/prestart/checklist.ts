/**
 * The standard prestart checks. Fixed keys, so a record answered today can
 * still be read when the wording is tuned; the label is what prints.
 * Unticked prints as a cross — an honest "no" or "not applicable today",
 * never a guess.
 */
export const PRESTART_CHECKS = [
  { key: 'fit', label: 'Everyone fit for work — no alcohol, drugs or fatigue concerns' },
  { key: 'ppe', label: 'PPE checked and worn for today’s tasks' },
  { key: 'plant', label: 'Plant pre-start checks done and logged' },
  { key: 'swms', label: 'SWMS for today’s tasks reviewed and signed' },
  { key: 'services', label: 'Services located and marked before breaking ground' },
  { key: 'exclusion', label: 'Exclusion zones, barricades and signage in place' },
  { key: 'emergency', label: 'Emergency plan, first aider and muster point known' },
  { key: 'permits', label: 'Permits in place for today’s work' },
] as const;

export type ChecklistKey = (typeof PRESTART_CHECKS)[number]['key'];
export type ChecklistState = Partial<Record<ChecklistKey, boolean>>;

export function readChecklist(value: unknown): ChecklistState {
  const out: ChecklistState = {};
  if (value && typeof value === 'object') {
    for (const item of PRESTART_CHECKS) {
      out[item.key] = Boolean((value as Record<string, unknown>)[item.key]);
    }
  }
  return out;
}
