import type { SupabaseClient } from '@supabase/supabase-js';

/** One of the crew's photographs for a day, as the diary shows it (README R172). */
export interface DayPhotoView { id: string; url: string; caption: string | null; takenAt: string | null; by: string | null; createdAt: string; signedUrl: string | null }
export type DayState = 'none' | 'open' | 'signed';

/**
 * The crew's photographs for one day on one job, under the caller's RLS, with links that last the hour, and where
 * the day's diary stands — not started, open, or signed — so the block can say what happens to the photos next.
 */
export async function loadDayPhotos(supabase: SupabaseClient, projectId: string, date: string): Promise<{ photos: DayPhotoView[]; dayState: DayState }> {
  const [{ data: rows }, { data: days }] = await Promise.all([
    supabase.from('day_photos').select('id, url, caption, taken_at, added_by, created_at').eq('project_id', projectId).eq('taken_on', date).order('created_at'),
    supabase.from('entries').select('id, status').eq('project_id', projectId).eq('entry_date', date),
  ]);
  const list = (rows ?? []) as Array<{ id: string; url: string; caption: string | null; taken_at: string | null; added_by: string; created_at: string }>;
  // Who took each: the name on the sheets, never an email (README R70).
  const names = new Map<string, string | null>();
  const urls: Record<string, string> = {};
  if (list.length) {
    const [{ data: people }, { data: signed }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').in('id', [...new Set(list.map((r) => r.added_by))]),
      supabase.storage.from('entry-photos').createSignedUrls(list.map((r) => r.url), 3600),
    ]);
    for (const pr of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(pr.id, pr.full_name);
    for (const d of signed ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  const photos = list.map((r) => ({ id: r.id, url: r.url, caption: r.caption, takenAt: r.taken_at, by: names.get(r.added_by) ?? null, createdAt: r.created_at, signedUrl: urls[r.url] ?? null }));
  const dayState: DayState = (days ?? []).some((d) => d.status !== 'signed') ? 'open' : (days ?? []).length ? 'signed' : 'none';
  return { photos, dayState };
}
