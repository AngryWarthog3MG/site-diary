import * as z from 'zod/v4';
import { SECTION_KEYS, type SectionKey } from '../extraction/schema.ts';

/**
 * What the supervisor confirms.
 *
 * Close to the extraction contract but not the same, and the differences are
 * the point:
 *
 *   * `source_quote` is nullable. An item the supervisor typed in themselves
 *     has no source quote, because nothing in the transcript says it — and
 *     claiming otherwise would put words in their mouth.
 *   * `confidence` is nullable for the same reason. A figure the supervisor
 *     entered is not the model being confident.
 *   * variations carry `photo_urls` and pours carry `docket_photo_urls`.
 *     Photos are taken, not spoken, so they only ever appear at this stage.
 */

const nullableText = z.string().trim().min(1).nullable().catch(null);
const nullableNumber = z.number().min(0).nullable().catch(null);
const confidence = z.enum(['high', 'low']).nullable().catch(null);
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable()
  .catch(null);
const urls = z.array(z.string().min(1)).default([]);

export const ReviewLabour = z.object({
  person_name: z.string().trim().min(1),
  role: nullableText,
  area: nullableText,
  hours: nullableNumber,
  overtime_hours: nullableNumber,
  source_quote: nullableText,
  confidence,
});

export const ReviewPlant = z.object({
  item: z.string().trim().min(1),
  hire_type: z.enum(['wet', 'dry']).nullable().catch(null),
  hours: nullableNumber,
  idle_hours: nullableNumber,
  supplier: nullableText,
  source_quote: nullableText,
  confidence,
});

export const ReviewWorkItem = z.object({
  area: nullableText,
  description: z.string().trim().min(1),
  percent_complete: z.number().min(0).max(100).nullable().catch(null),
  source_quote: nullableText,
  confidence,
});

export const ReviewVariation = z.object({
  description: z.string().trim().min(1),
  directed_by: nullableText,
  directed_at: z.string().nullable().catch(null),
  vr_ref: nullableText,
  estimated_cost: nullableNumber,
  photo_urls: urls,
  source_quote: nullableText,
  confidence,
});

export const ReviewDelay = z.object({
  start_time: timeOfDay,
  end_time: timeOfDay,
  duration_mins: z.number().int().min(0).nullable().catch(null),
  cause: nullableText,
  personnel_affected: z.number().int().min(0).nullable().catch(null),
  category: z.enum(['weather', 'access', 'design', 'other']).nullable().catch(null),
  source_quote: nullableText,
  confidence,
});

export const ReviewPour = z.object({
  location: nullableText,
  volume_m3: nullableNumber,
  mix_spec: nullableText,
  supplier: nullableText,
  docket_nos: z.array(z.string().min(1)).default([]),
  start_time: timeOfDay,
  finish_time: timeOfDay,
  docket_photo_urls: urls,
  source_quote: nullableText,
  confidence,
});

export const ReviewQuantity = z.object({
  item_type: z.string().trim().min(1),
  area: nullableText,
  quantity: z.number().nullable().catch(null),
  unit: nullableText,
  source_quote: nullableText,
  confidence,
});

export const ReviewSection = z.object({
  section: z.enum(SECTION_KEYS as [SectionKey, ...SectionKey[]]),
  state: z.enum(['gap', 'captured', 'nil_confirmed']),
  note: nullableText,
});

export const ReviewPayload = z.object({
  labour: z.array(ReviewLabour).default([]),
  plant: z.array(ReviewPlant).default([]),
  work_items: z.array(ReviewWorkItem).default([]),
  variations: z.array(ReviewVariation).default([]),
  delays: z.array(ReviewDelay).default([]),
  pours: z.array(ReviewPour).default([]),
  quantities: z.array(ReviewQuantity).default([]),
  sections: z.array(ReviewSection).default([]),
  weather_impact: nullableText,
  notes: nullableText,
});

export type ReviewPayload = z.infer<typeof ReviewPayload>;
export type ReviewLabour = z.infer<typeof ReviewLabour>;
export type ReviewPlant = z.infer<typeof ReviewPlant>;
export type ReviewWorkItem = z.infer<typeof ReviewWorkItem>;
export type ReviewVariation = z.infer<typeof ReviewVariation>;
export type ReviewDelay = z.infer<typeof ReviewDelay>;
export type ReviewPour = z.infer<typeof ReviewPour>;
export type ReviewQuantity = z.infer<typeof ReviewQuantity>;

export type ItemGroup =
  | 'labour'
  | 'plant'
  | 'work_items'
  | 'variations'
  | 'delays'
  | 'pours'
  | 'quantities';

/**
 * The four gates from §4, evaluated against what is on screen right now.
 *
 * The database enforces these too, and refuses to sign an entry that fails
 * them — this exists so the amber prompts appear as the supervisor types
 * rather than only when they press the button. `public.entry_review_state()`
 * is the authority; if the two ever disagree, the database wins and the sign
 * attempt is refused.
 */
export function reviewBlockingGaps(payload: ReviewPayload): string[] {
  const gaps = new Set<string>();

  for (const variation of payload.variations) {
    if (!variation.vr_ref?.trim()) gaps.add('variation_missing_vr_ref');
    // A photo is optional (owner decision, 2026-08-27). The VR reference is
    // not: without it the variation cannot be claimed.
  }
  for (const pour of payload.pours) {
    if (pour.volume_m3 == null) gaps.add('pour_missing_volume_m3');
  }
  for (const delay of payload.delays) {
    if (delay.start_time == null || delay.end_time == null) gaps.add('delay_missing_times');
  }

  return [...gaps].sort();
}

/**
 * What each gap means, in words a supervisor can act on.
 *
 * `short` is what appears in the list at the top of the screen — four
 * full-width paragraphs of amber pushed the whole docket off a phone, which is
 * a good way to teach someone to scroll past the warnings. `why` is the reason
 * it matters, shown against the offending section.
 */
export const GAP_PROMPTS: Record<string, { group: ItemGroup; short: string; why: string }> = {
  variation_missing_vr_ref: {
    group: 'variations',
    short: 'Variation needs a VR reference',
    why: 'Without a reference the claim has nothing to hang on.',
  },
  pour_missing_volume_m3: {
    group: 'pours',
    short: 'Pour needs a volume',
    why: 'Check the docket.',
  },
  delay_missing_times: {
    group: 'delays',
    short: 'Delay needs a start and finish time',
    why: 'Both are needed to claim the time.',
  },
};

export const WARNING_PROMPTS: Record<string, string> = {
  weather_delay_without_rainfall:
    'You have claimed a weather delay on a day the gauge recorded no rain. That may well be right — the station can be kilometres away — but confirm it before signing.',
  weather_delay_without_weather_record:
    'You have claimed a weather delay and there is no weather on this entry yet.',
  weather_station_far_from_site:
    'The weather on this entry came from a station well away from site.',
};
