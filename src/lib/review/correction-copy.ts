/**
 * What a correction carries forward from the signed day it supersedes
 * (README R121).
 *
 * A correction opens as a copy of the signed entry, so the person only changes
 * what was wrong. The copy is a list of columns per table — and a column left
 * off the list is a fact silently dropped from the record: the labour list
 * lost its start and finish clocks this way (the gate then wrote its own over
 * the blanks, four signed versions running), and the whole site events section
 * was never copied at all. So the lists live here, beside the review contract,
 * and a test holds each one to every field that contract carries.
 *
 * Pure, relative imports — node-tested.
 */
export const CORRECTION_COPY = {
  labour: ['person_name', 'role', 'area', 'start_time', 'finish_time', 'break_mins', 'hours', 'overtime_hours', 'source_quote', 'confidence'],
  plant: ['item', 'hire_type', 'hours', 'idle_hours', 'supplier', 'source_quote', 'confidence'],
  work_items: ['area', 'description', 'percent_complete', 'source_quote', 'confidence'],
  // `variation_number` is the register link's number for rows signed before the number lived on the day.
  variations: ['description', 'directed_by', 'directed_at', 'vr_ref', 'estimated_cost', 'crew', 'register_seq', 'variation_number', 'hours', 'photo_urls', 'source_quote', 'confidence'],
  delays: ['start_time', 'end_time', 'duration_mins', 'cause', 'personnel_affected', 'category', 'source_quote', 'confidence'],
  pours: ['location', 'volume_m3', 'mix_spec', 'supplier', 'docket_nos', 'start_time', 'finish_time', 'docket_photo_urls', 'source_quote', 'confidence'],
  quantities: ['item_type', 'area', 'quantity', 'unit', 'source_quote', 'confidence'],
  dayworks: ['description', 'labour', 'labour_rows', 'plant', 'materials', 'hours', 'docket_ref', 'photo_urls', 'source_quote', 'confidence'],
  site_events: ['said_text', 'location', 'directed_by', 'occurred_time', 'photo_urls', 'source_quote', 'confidence'],
  photos: ['url', 'caption', 'category', 'taken_at', 'lat', 'lng'],
} as const;

export type CopiedTable = keyof typeof CORRECTION_COPY;

export function copyColumns(table: CopiedTable): string {
  return CORRECTION_COPY[table].join(', ');
}
