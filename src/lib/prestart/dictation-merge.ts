/**
 * Fold a dictated briefing into a prestart form without losing a word the
 * supervisor already typed.
 *
 * An empty field takes the dictation. A field with something in it keeps it
 * and gets the dictation appended on a new line — the supervisor decides
 * what stays. Nothing is ever replaced. Checklist ticks are not part of this:
 * a check that prints as done was ticked by a person on the day.
 */
export interface DictatedFields {
  work_planned: string | null;
  hazards: string | null;
  plant: string | null;
  permits: string | null;
  notes: string | null;
}

export const DICTATED_KEYS = ['work_planned', 'hazards', 'plant', 'permits', 'notes'] as const;

export function mergeField(existing: string, dictated: string | null): string {
  const add = (dictated ?? '').trim();
  if (!add) return existing;
  const have = existing.trim();
  if (!have) return add;
  if (have.includes(add)) return existing;
  return `${have}\n${add}`;
}

/** The transcript kept on the row: one dictation, or several joined in order. */
export function appendDictation(existing: string | null, transcript: string): string {
  const add = transcript.trim();
  const have = (existing ?? '').trim();
  if (!add) return have;
  if (!have) return add;
  return `${have}\n\n${add}`;
}
