import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Photographs on a SIGNED record (README R176, R189): added after what the record already carries, and the ones added
 * after sign-off taken off again, under the database's rule that the signed-with photographs stay first and untouched
 * and nothing else on the record changes. Reads the list first so a phone replaying from its outbox adds its own and
 * drops none that arrived in between. A removed file stays in storage; the removal row is what names it.
 */
export async function changeQaPhotos(supabase: SupabaseClient, recordId: string, change: { add?: string[]; remove?: string[] }): Promise<void> {
  const { data: cur, error } = await supabase.from('qa_records').select('photo_paths').eq('id', recordId).maybeSingle();
  if (error) throw error;
  if (!cur) throw new Error('That record is not on your account.');
  const have = (cur.photo_paths as string[] | null) ?? [];
  const remove = new Set(change.remove ?? []);
  const add = (change.add ?? []).filter((p) => !have.includes(p));
  const next = [...have.filter((p) => !remove.has(p)), ...add];
  if (next.length === have.length && next.every((p, i) => p === have[i])) return;
  const { data, error: e } = await supabase.from('qa_records').update({ photo_paths: next }).eq('id', recordId).select('id');
  if (e) throw e;
  if (!data?.length) throw new Error('Your role on this job does not write QA records.');
}

/** Photographs appended to a signed record (README R176). */
export const appendQaPhotos = (supabase: SupabaseClient, recordId: string, paths: string[]) => changeQaPhotos(supabase, recordId, { add: paths });

export interface QaPhotoAddition { paths: string[]; by: string | null; at: string }
export interface QaPhotoRemoval { paths: string[]; by: string | null; at: string }

/** Path → when and by whom it was added after sign-off; a path not in the map was there when the record was signed. */
export function addedAfterSignoff(additions: QaPhotoAddition[]): Record<string, { at: string; by: string | null }> {
  const out: Record<string, { at: string; by: string | null }> = {};
  for (const a of additions) for (const p of a.paths) if (!out[p]) out[p] = { at: a.at, by: a.by };
  return out;
}

/** The removals made after sign-off (README R189): the ones on an open record are storage's business, not the sheet's. */
export function removalsAfterSignoff(removals: QaPhotoRemoval[], completedAt: string | null): QaPhotoRemoval[] {
  if (!completedAt) return [];
  const t = Date.parse(completedAt);
  return removals.filter((r) => Date.parse(r.at) >= t);
}
