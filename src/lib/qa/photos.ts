import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Photographs added to a SIGNED record (README R176): appended to what the record already carries, under the
 * database's rule that a signed record's list of photographs grows and nothing else on it changes. Reads the list
 * first so a phone replaying from its outbox adds its own and drops none that arrived in between.
 */
export async function appendQaPhotos(supabase: SupabaseClient, recordId: string, paths: string[]): Promise<void> {
  const { data: cur, error } = await supabase.from('qa_records').select('photo_paths').eq('id', recordId).maybeSingle();
  if (error) throw error;
  if (!cur) throw new Error('That record is not on your account.');
  const have = (cur.photo_paths as string[] | null) ?? [];
  const add = paths.filter((p) => !have.includes(p));
  if (!add.length) return;
  const { data, error: e } = await supabase.from('qa_records').update({ photo_paths: [...have, ...add] }).eq('id', recordId).select('id');
  if (e) throw e;
  if (!data?.length) throw new Error('Your role on this job does not write QA records.');
}

export interface QaPhotoAddition { paths: string[]; by: string | null; at: string }

/** Path → when and by whom it was added after sign-off; a path not in the map was there when the record was signed. */
export function addedAfterSignoff(additions: QaPhotoAddition[]): Record<string, { at: string; by: string | null }> {
  const out: Record<string, { at: string; by: string | null }> = {};
  for (const a of additions) for (const p of a.paths) if (!out[p]) out[p] = { at: a.at, by: a.by };
  return out;
}
