import { SECTION_KEYS, type ExtractionProposal, type SectionKey } from './schema.ts';

/**
 * Scoring an extraction against a hand-written expected result (brief §10).
 *
 * The headline number is deliberately not "accuracy". Two failures matter very
 * differently here:
 *
 *   * **missed** — a value was stated and the model left it null. The app asks
 *     the supervisor for it. Annoying, recoverable, visible.
 *   * **invented** — nothing was stated and the model produced a value. The
 *     supervisor is being shown a plausible number to approve, and nobody will
 *     ever question it again.
 *
 * §2.4 forbids the second outright, so `invented` is reported separately and is
 * the number to watch on a prompt change. A run with zero invented values and
 * some misses is healthy; the reverse is not.
 *
 * Free text (descriptions, causes, roles) is scored separately and loosely —
 * the model will phrase a description differently every time, and folding that
 * into the same figure as "was the pour 18 m3 or 21" would make the figure
 * meaningless.
 */

export type Verdict = 'correct' | 'missed' | 'invented' | 'wrong';

export interface FieldResult {
  section: string;
  item: string;
  field: string;
  verdict: Verdict;
  expected: unknown;
  actual: unknown;
}

export interface Tally {
  correct: number;
  missed: number;
  invented: number;
  wrong: number;
}

export interface Score {
  /** Strictly-compared values: numbers, times, enums, references. */
  values: Tally;
  /** Loosely-compared free text. */
  text: Tally;
  items: {
    expected: number;
    predicted: number;
    matched: number;
    /** In the expected result, absent from the prediction. */
    missed: number;
    /** In the prediction, absent from the expected result — an invented item. */
    spurious: number;
  };
  sectionStates: Tally;
  failures: FieldResult[];
  /** Correct strict values as a fraction of those compared. */
  valueAccuracy: number;
  /** The number that gates a prompt change. */
  invented: number;
}

interface SectionSpec<T> {
  key: SectionKey | 'pours' | 'quantities';
  items: (p: ExtractionProposal) => readonly T[];
  identity: (item: T) => string;
  strict: readonly (keyof T)[];
  loose: readonly (keyof T)[];
}

function spec<T>(s: SectionSpec<T>): SectionSpec<T> {
  return s;
}

const SPECS = [
  spec({
    key: 'labour' as const,
    items: (p: ExtractionProposal) => p.labour,
    identity: (i) => i.person_name,
    strict: ['hours', 'overtime_hours'] as const,
    loose: ['role', 'area'] as const,
  }),
  spec({
    key: 'plant' as const,
    items: (p: ExtractionProposal) => p.plant,
    identity: (i) => i.item,
    strict: ['hours', 'idle_hours', 'hire_type'] as const,
    loose: ['supplier'] as const,
  }),
  spec({
    key: 'work_items' as const,
    items: (p: ExtractionProposal) => p.work_items,
    identity: (i) => `${i.area ?? ''} ${i.description}`,
    strict: ['percent_complete'] as const,
    loose: ['area', 'description'] as const,
  }),
  spec({
    key: 'variations' as const,
    items: (p: ExtractionProposal) => p.variations,
    identity: (i) => i.description,
    strict: ['vr_ref', 'estimated_cost', 'directed_at'] as const,
    loose: ['directed_by', 'description'] as const,
  }),
  spec({
    key: 'delays' as const,
    items: (p: ExtractionProposal) => p.delays,
    identity: (i) => `${i.cause ?? ''} ${i.start_time ?? ''}`,
    strict: ['start_time', 'end_time', 'duration_mins', 'personnel_affected', 'category'] as const,
    loose: ['cause'] as const,
  }),
  spec({
    key: 'pours' as const,
    items: (p: ExtractionProposal) => p.pours,
    identity: (i) => i.location ?? 'pour',
    strict: ['volume_m3', 'start_time', 'finish_time', 'docket_nos'] as const,
    loose: ['mix_spec', 'supplier', 'location'] as const,
  }),
  spec({
    key: 'quantities' as const,
    items: (p: ExtractionProposal) => p.quantities,
    identity: (i) => i.item_type,
    strict: ['quantity', 'unit'] as const,
    loose: ['area', 'item_type'] as const,
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as unknown as SectionSpec<any>[];

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token overlap, so "Danny" matches "Danny Rowe" and "Pier 3" matches
 * "pier 3 blinding".
 *
 * A subset scores below an exact match on purpose. Dividing by the smaller
 * token count means "sleeve" overlaps "sleeve diameter" completely, and
 * without the cap those two would be indistinguishable from a real match —
 * the matcher would happily pair each with the other and report four wrong
 * values on an identical pair of entries.
 */
export function similarity(a: string, b: string): number {
  const leftText = normalise(a);
  const rightText = normalise(b);
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;

  const left = new Set(leftText.split(' ').filter(Boolean));
  const right = new Set(rightText.split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (shared / Math.min(left.size, right.size)) * 0.95;
}

const MATCH_THRESHOLD = 0.5;

function equalValues(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const e = [...expected].map(String).sort();
    const a = [...actual].map(String).sort();
    return e.length === a.length && e.every((v, i) => v === a[i]);
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) < 1e-6;
  }
  if (typeof expected === 'string' && typeof actual === 'string') {
    return normalise(expected) === normalise(actual);
  }
  return expected === actual;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function judge(expected: unknown, actual: unknown, loose: boolean): Verdict {
  const expectedEmpty = isEmpty(expected);
  const actualEmpty = isEmpty(actual);

  if (expectedEmpty && actualEmpty) return 'correct';
  if (expectedEmpty) return 'invented';
  if (actualEmpty) return 'missed';

  if (loose && typeof expected === 'string' && typeof actual === 'string') {
    return similarity(expected, actual) >= MATCH_THRESHOLD ? 'correct' : 'wrong';
  }
  return equalValues(expected, actual) ? 'correct' : 'wrong';
}

function record(tally: Tally, verdict: Verdict) {
  tally[verdict] += 1;
}

const emptyTally = (): Tally => ({ correct: 0, missed: 0, invented: 0, wrong: 0 });

export function scoreProposal(
  expected: ExtractionProposal,
  predicted: ExtractionProposal,
): Score {
  const values = emptyTally();
  const text = emptyTally();
  const sectionStates = emptyTally();
  const failures: FieldResult[] = [];
  const items = { expected: 0, predicted: 0, matched: 0, missed: 0, spurious: 0 };

  const note = (result: FieldResult) => {
    if (result.verdict !== 'correct') failures.push(result);
  };

  for (const section of SPECS) {
    const expectedItems = section.items(expected);
    const predictedItems = [...section.items(predicted)];
    items.expected += expectedItems.length;
    items.predicted += predictedItems.length;

    for (const want of expectedItems) {
      // Greedy best match on identity, so ordering differences do not count
      // as errors — the supervisor did not say them in a defined order.
      let bestIndex = -1;
      let bestScore = -1;
      predictedItems.forEach((candidate, index) => {
        const score = similarity(section.identity(want), section.identity(candidate));
        // Strictly better, so a tie keeps the earlier candidate rather than
        // drifting to the last one that happened to score the same.
        if (score >= MATCH_THRESHOLD && score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });

      if (bestIndex === -1) {
        items.missed += 1;
        // Everything it should have carried is a miss.
        for (const field of section.strict) {
          if (!isEmpty(want[field])) {
            record(values, 'missed');
            note({
              section: String(section.key),
              item: section.identity(want),
              field: String(field),
              verdict: 'missed',
              expected: want[field],
              actual: undefined,
            });
          }
        }
        continue;
      }

      const got = predictedItems.splice(bestIndex, 1)[0];
      items.matched += 1;

      for (const field of section.strict) {
        const verdict = judge(want[field], got[field], false);
        record(values, verdict);
        note({
          section: String(section.key),
          item: section.identity(want),
          field: String(field),
          verdict,
          expected: want[field],
          actual: got[field],
        });
      }
      for (const field of section.loose) {
        const verdict = judge(want[field], got[field], true);
        record(text, verdict);
        note({
          section: String(section.key),
          item: section.identity(want),
          field: String(field),
          verdict,
          expected: want[field],
          actual: got[field],
        });
      }
    }

    // Anything left over was not in the expected result at all.
    for (const extra of predictedItems) {
      items.spurious += 1;
      for (const field of section.strict) {
        if (!isEmpty(extra[field])) {
          record(values, 'invented');
          note({
            section: String(section.key),
            item: section.identity(extra),
            field: String(field),
            verdict: 'invented',
            expected: undefined,
            actual: extra[field],
          });
        }
      }
    }
  }

  for (const key of SECTION_KEYS) {
    const verdict =
      expected.sections[key].state === predicted.sections[key].state ? 'correct' : 'wrong';
    record(sectionStates, verdict);
    note({
      section: 'sections',
      item: key,
      field: 'state',
      verdict,
      expected: expected.sections[key].state,
      actual: predicted.sections[key].state,
    });
  }

  const impact = judge(expected.weather_impact, predicted.weather_impact, true);
  record(text, impact);
  note({
    section: 'weather',
    item: 'weather_impact',
    field: 'weather_impact',
    verdict: impact,
    expected: expected.weather_impact,
    actual: predicted.weather_impact,
  });

  const compared = values.correct + values.missed + values.invented + values.wrong;

  return {
    values,
    text,
    items,
    sectionStates,
    failures,
    valueAccuracy: compared === 0 ? 1 : values.correct / compared,
    // An invented item is an invented value even when its own fields are null:
    // the item itself was never said.
    invented: values.invented + items.spurious,
  };
}

/** Aggregate scores across the fixture set. */
export function summarise(scores: readonly Score[]) {
  const add = (a: Tally, b: Tally): Tally => ({
    correct: a.correct + b.correct,
    missed: a.missed + b.missed,
    invented: a.invented + b.invented,
    wrong: a.wrong + b.wrong,
  });

  const values = scores.reduce((acc, s) => add(acc, s.values), emptyTally());
  const text = scores.reduce((acc, s) => add(acc, s.text), emptyTally());
  const sectionStates = scores.reduce((acc, s) => add(acc, s.sectionStates), emptyTally());
  const compared = values.correct + values.missed + values.invented + values.wrong;
  const stateCompared =
    sectionStates.correct + sectionStates.missed + sectionStates.invented + sectionStates.wrong;

  return {
    values,
    text,
    sectionStates,
    valueAccuracy: compared === 0 ? 1 : values.correct / compared,
    sectionAccuracy: stateCompared === 0 ? 1 : sectionStates.correct / stateCompared,
    invented: scores.reduce((total, s) => total + s.invented, 0),
    spuriousItems: scores.reduce((total, s) => total + s.items.spurious, 0),
    missedItems: scores.reduce((total, s) => total + s.items.missed, 0),
  };
}
