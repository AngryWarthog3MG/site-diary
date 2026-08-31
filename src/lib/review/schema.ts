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

export const ReviewDaywork = z.object({
  description: z.string().trim().min(1),
  labour: nullableText,
  plant: nullableText,
  materials: nullableText,
  hours: nullableNumber,
  docket_ref: nullableText,
  photo_urls: urls,
  source_quote: nullableText,
  confidence,
});

export const PHOTO_CATEGORIES = [
  'progress',
  'works',
  'delay',
  'variation',
  'pour',
  'safety',
  'general',
] as const;

export const ReviewPhoto = z.object({
  url: z.string().trim().min(1),
  caption: nullableText,
  category: z.enum(PHOTO_CATEGORIES).nullable().catch(null),
  taken_at: z.string().nullable().catch(null),
  lat: z.number().nullable().catch(null),
  lng: z.number().nullable().catch(null),
});

export const ReviewWeatherReading = z.object({
  temp_max: nullableNumber,
  temp_min: nullableNumber,
  rainfall_mm: nullableNumber,
  wind_dir: nullableText,
  wind_kmh: nullableNumber,
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
  dayworks: z.array(ReviewDaywork).default([]),
  photos: z.array(ReviewPhoto).default([]),
  weather: ReviewWeatherReading.default({
    temp_max: null,
    temp_min: null,
    rainfall_mm: null,
    wind_dir: null,
    wind_kmh: null,
  }),
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
export type ReviewDaywork = z.infer<typeof ReviewDaywork>;
export type ReviewPhoto = z.infer<typeof ReviewPhoto>;
export type ReviewWeatherReading = z.infer<typeof ReviewWeatherReading>;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export type ItemGroup =
  | 'labour'
  | 'plant'
  | 'work_items'
  | 'variations'
  | 'delays'
  | 'pours'
  | 'quantities'
  | 'dayworks';

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

export type ReviewQualityWarning =
  | 'labour_missing_hours'
  | 'plant_missing_hours'
  | 'delay_people_without_cause'
  | 'pour_volume_without_docket'
  | 'variation_ref_without_directed_by'
  | 'quantity_missing_unit'
  | 'weather_impact_without_weather_delay'
  | 'weather_delay_without_impact'
  | 'low_confidence_items';

export function reviewQualityWarnings(payload: ReviewPayload): ReviewQualityWarning[] {
  const warnings = new Set<ReviewQualityWarning>();

  if (payload.labour.some((item) => item.hours == null)) {
    warnings.add('labour_missing_hours');
  }
  if (payload.plant.some((item) => item.hours == null)) {
    warnings.add('plant_missing_hours');
  }
  if (payload.delays.some((item) => item.personnel_affected != null && !item.cause?.trim())) {
    warnings.add('delay_people_without_cause');
  }
  if (
    payload.pours.some(
      (item) =>
        item.volume_m3 != null &&
        item.docket_nos.length === 0 &&
        item.docket_photo_urls.length === 0,
    )
  ) {
    warnings.add('pour_volume_without_docket');
  }
  if (payload.variations.some((item) => item.vr_ref?.trim() && !item.directed_by?.trim())) {
    warnings.add('variation_ref_without_directed_by');
  }
  if (payload.quantities.some((item) => item.quantity != null && !item.unit?.trim())) {
    warnings.add('quantity_missing_unit');
  }

  const hasWeatherImpact = Boolean(payload.weather_impact?.trim());
  const hasWeatherDelay = payload.delays.some((item) => item.category === 'weather');
  if (hasWeatherImpact && !hasWeatherDelay) {
    warnings.add('weather_impact_without_weather_delay');
  }
  if (hasWeatherDelay && !hasWeatherImpact) {
    warnings.add('weather_delay_without_impact');
  }

  if (
    [
      ...payload.labour,
      ...payload.plant,
      ...payload.work_items,
      ...payload.variations,
      ...payload.delays,
      ...payload.pours,
      ...payload.quantities,
      ...payload.dayworks,
    ].some((item) => item.confidence === 'low')
  ) {
    warnings.add('low_confidence_items');
  }

  return [...warnings].sort();
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
  labour_missing_hours:
    'Labour has a person with no hours. Leave it blank only if the hours genuinely were not stated.',
  plant_missing_hours:
    'Plant has an item with no hours. Check whether working or idle time should be recorded.',
  delay_people_without_cause:
    'A delay records people affected but no cause. Add the cause if you know it.',
  pour_volume_without_docket:
    'A concrete pour has volume but no docket number or docket photo. Attach the docket where possible.',
  variation_ref_without_directed_by:
    'A variation has a VR reference but no “directed by”. Add who instructed it if known.',
  quantity_missing_unit:
    'A quantity has a number but no unit. Add the unit so the total makes sense later.',
  weather_impact_without_weather_delay:
    'Weather impact is described, but there is no weather delay item. Check whether a delay should be added.',
  weather_delay_without_impact:
    'A weather delay is listed, but the Weather tab has no impact note. Add what the weather did to the work.',
  low_confidence_items:
    'One or more extracted items were low confidence. Open the highlighted section and check them before signing.',
};

export const WARNING_GROUPS: Partial<Record<ReviewQualityWarning, ItemGroup | 'weather'>> = {
  labour_missing_hours: 'labour',
  plant_missing_hours: 'plant',
  delay_people_without_cause: 'delays',
  pour_volume_without_docket: 'pours',
  variation_ref_without_directed_by: 'variations',
  quantity_missing_unit: 'quantities',
  weather_impact_without_weather_delay: 'weather',
  weather_delay_without_impact: 'weather',
};
