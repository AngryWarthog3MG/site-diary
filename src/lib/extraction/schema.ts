import * as z from 'zod/v4';

/**
 * The JSON contract (brief §8 item 3).
 *
 * Two rules shape every field:
 *
 *   * Everything is required but nullable, never optional. The model emits an
 *     explicit `null` rather than leaving a key out, so "not stated" is a
 *     positive assertion in the output instead of something inferred from an
 *     absence. That is what makes §2.4 — never invent a number — checkable.
 *   * Every extracted object carries `source_quote` and `confidence` (§4), so
 *     the review screen can show the supervisor which words a number came from
 *     and pre-flag the shaky ones.
 *
 * This schema is not sent to the API as a structured output format, and not
 * for want of trying. Structured outputs enforce three separate ceilings — at
 * most 16 parameters carrying unions, at most 24 optional ones, and a cap on
 * total compiled grammar size — and a contract with seven arrays of objects
 * and forty-odd fields breaches all three however it is expressed. The API's
 * answer was blunt:
 *
 *   The compiled grammar is too large, which would cause performance issues.
 *
 * So the schema is rendered into the prompt and enforced here instead, which
 * is what brief §4 specified in the first place: "return JSON only, matching
 * the supplied schema". The response is parsed and validated against this
 * before it becomes a proposal; anything that does not match is an error, not
 * a partial result.
 */

export const CONFIDENCE = ['high', 'low'] as const;
export const SECTION_STATES = ['captured', 'nil_confirmed', 'gap'] as const;

/**
 * Shared field builders. Every one tolerates a malformed value by falling back
 * to null rather than failing the whole extraction — one mangled time should
 * cost that field, not the day's record.
 */
const nullableText = z.string().trim().min(1).nullable().default(null).catch(null);
const nullableNumber = z.number().min(0).nullable().default(null).catch(null);
const nullableTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM on a 24-hour clock')
  .nullable()
  .default(null)
  .catch(null);

/** The span of transcript an object came from. Never paraphrased. */
const sourceQuote = z.string().min(1).nullable().default(null).catch(null);

const confidence = z.enum(CONFIDENCE).nullable().default(null).catch(null);

const LabourItem = z.object({
  person_name: z.string().min(1),
  role: nullableText,
  area: nullableText,
  start_time: nullableTime,
  finish_time: nullableTime,
  /** Unpaid break in minutes — only when stated; usually 30 on this site. */
  break_mins: nullableNumber,
  hours: nullableNumber,
  overtime_hours: nullableNumber,
  source_quote: sourceQuote,
  confidence,
});

const PlantItem = z.object({
  item: z.string().min(1),
  hire_type: z.enum(['wet', 'dry']).nullable().default(null).catch(null),
  hours: nullableNumber,
  idle_hours: nullableNumber,
  supplier: nullableText,
  source_quote: sourceQuote,
  confidence,
});

const WorkItem = z.object({
  area: nullableText,
  description: z.string().min(1),
  percent_complete: z.number().min(0).max(100).nullable().default(null).catch(null),
  source_quote: sourceQuote,
  confidence,
});

const VariationItem = z.object({
  description: z.string().min(1),
  directed_by: nullableText,
  /** Local "YYYY-MM-DDTHH:MM" resolved against the entry date, or null. */
  directed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null)
    .catch(null),
  vr_ref: nullableText,
  estimated_cost: nullableNumber,
  source_quote: sourceQuote,
  confidence,
});

const DelayItem = z.object({
  start_time: nullableTime,
  end_time: nullableTime,
  duration_mins: z.number().int().min(0).nullable().default(null).catch(null),
  cause: nullableText,
  personnel_affected: z.number().int().min(0).nullable().default(null).catch(null),
  category: z.enum(['weather', 'access', 'design', 'other']).nullable().default(null).catch(null),
  source_quote: sourceQuote,
  confidence,
});

const PourItem = z.object({
  location: nullableText,
  volume_m3: nullableNumber,
  mix_spec: nullableText,
  supplier: nullableText,
  docket_nos: z.array(z.string()).default([]).catch([]),
  start_time: nullableTime,
  finish_time: nullableTime,
  source_quote: sourceQuote,
  confidence,
});

const QuantityItem = z.object({
  item_type: z.string().min(1),
  area: nullableText,
  quantity: z.number().nullable().default(null).catch(null),
  /** Normalised: "cubes" becomes m3, "mil" becomes mm. */
  unit: nullableText,
  source_quote: sourceQuote,
  confidence,
});

const DayworkItem = z.object({
  description: z.string().min(1),
  labour: nullableText,
  plant: nullableText,
  materials: nullableText,
  hours: nullableNumber,
  docket_ref: nullableText,
  source_quote: sourceQuote,
  confidence,
});

/**
 * Per-section outcome (§4).
 *
 * `nil_confirmed` is the one that matters: a supervisor saying "no plant on
 * site today" is a recorded answer, and it has to be distinguishable from
 * never having mentioned plant at all.
 */
const SectionOutcome = z.object({
  state: z.enum(SECTION_STATES),
  /** The words that settled it, when there were any. */
  source_quote: nullableText,
});

export {
  LabourItem,
  PlantItem,
  WorkItem,
  VariationItem,
  DelayItem,
  PourItem,
  QuantityItem,
  DayworkItem,
  SectionOutcome,
};

export const ExtractionProposal = z.object({
  labour: z.array(LabourItem).default([]),
  plant: z.array(PlantItem).default([]),
  work_items: z.array(WorkItem).default([]),
  variations: z.array(VariationItem).default([]),
  delays: z.array(DelayItem).default([]),
  pours: z.array(PourItem).default([]),
  quantities: z.array(QuantityItem).default([]),
  dayworks: z.array(DayworkItem).default([]),
  weather_impact: nullableText,

  /**
   * Anything material the supervisor said that fits no other section —
   * deliveries booked, toolbox talks, site access changes. Close to the
   * spoken words; never a summary of things already captured elsewhere.
   */
  notes: nullableText,

  sections: z.object({
    labour: SectionOutcome,
    plant: SectionOutcome,
    work_items: SectionOutcome,
    variations: SectionOutcome,
    delays: SectionOutcome,
    weather: SectionOutcome,
  }),
});

export type ExtractionProposal = z.infer<typeof ExtractionProposal>;
export type LabourItem = z.infer<typeof LabourItem>;
export type PlantItem = z.infer<typeof PlantItem>;
export type WorkItem = z.infer<typeof WorkItem>;
export type VariationItem = z.infer<typeof VariationItem>;
export type DelayItem = z.infer<typeof DelayItem>;
export type PourItem = z.infer<typeof PourItem>;
export type QuantityItem = z.infer<typeof QuantityItem>;
export type DayworkItem = z.infer<typeof DayworkItem>;
export type SectionOutcome = z.infer<typeof SectionOutcome>;
export type SectionKey = keyof ExtractionProposal['sections'];

export const SECTION_KEYS: SectionKey[] = [
  'labour',
  'plant',
  'work_items',
  'variations',
  'delays',
  'weather',
];

/** An empty proposal — the shape a transcript with nothing in it produces. */
export function emptyProposal(): ExtractionProposal {
  const gap = { state: 'gap' as const, source_quote: null };
  return {
    labour: [],
    plant: [],
    work_items: [],
    variations: [],
    delays: [],
    pours: [],
    quantities: [],
    dayworks: [],
    weather_impact: null,
    notes: null,
    sections: {
      labour: gap,
      plant: gap,
      work_items: gap,
      variations: gap,
      delays: gap,
      weather: gap,
    },
  };
}
