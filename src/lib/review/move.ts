/**
 * Moving a daywork item into variations.
 *
 * Work that belongs to a variation filed under dayworks is the same work in
 * the wrong folder: a progress claim never finds it and the register never
 * adds up its hours. It happened on Curtin across five days (README R81), and
 * putting it right meant hand-editing the database. This is the tap that does
 * it instead.
 *
 * It only ever moves a row on an unsigned draft, like every other edit on the
 * review screen. A signed day is put right by a correction that supersedes it.
 *
 * Nothing is invented and nothing is dropped. A variation has no labour, plant,
 * materials or docket field, so whatever the daywork carried in those is kept
 * in the description exactly as it was typed — losing the plant off a variation
 * claim loses money. The crew list is left empty on purpose: splitting free
 * text like "2x Marcus Hayden , Evan Burke" into names invents a person called
 * "2x Marcus Hayden", and the names are one tap each on the row itself.
 */
import type { ReviewDaywork, ReviewPayload, ReviewVariation } from './schema';

/** The parts of a daywork a variation has nowhere to put, in the words that were typed. */
export function carriedOver(daywork: Pick<ReviewDaywork, 'labour' | 'plant' | 'materials' | 'docket_ref'>): string | null {
  const parts = [
    ['labour', daywork.labour],
    ['plant', daywork.plant],
    ['materials', daywork.materials],
    ['docket', daywork.docket_ref],
  ] as const;
  const kept = parts
    .map(([name, value]) => [name, (value ?? '').trim()] as const)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `${name}: ${value}`);
  return kept.length > 0 ? kept.join('; ') : null;
}

/** One daywork item as a variation of the register item picked. */
export function dayworkAsVariation(daywork: ReviewDaywork, registerSeq: number | null): ReviewVariation {
  const rest = carriedOver(daywork);
  return {
    description: rest ? `${daywork.description.trim()} (${rest})` : daywork.description.trim(),
    directed_by: null,
    directed_at: null,
    vr_ref: null,
    estimated_cost: null,
    crew: [],
    register_seq: registerSeq,
    // Hours travel as recorded. Unstated stays unstated — the gap will ask.
    hours: daywork.hours,
    photo_urls: [...daywork.photo_urls],
    source_quote: daywork.source_quote,
    confidence: daywork.confidence,
  };
}

/**
 * The payload with daywork `index` moved to the end of the variations list.
 * An index that is not there returns the payload unchanged, so a double tap
 * on a slow phone cannot move the row after it.
 */
export function moveDayworkToVariations(payload: ReviewPayload, index: number, registerSeq: number | null): ReviewPayload {
  const daywork = payload.dayworks[index];
  if (!daywork) return payload;
  return {
    ...payload,
    dayworks: payload.dayworks.filter((_, i) => i !== index),
    variations: [...payload.variations, dayworkAsVariation(daywork, registerSeq)],
  };
}
