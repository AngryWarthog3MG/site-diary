import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_CONTEXT } from '@/lib/pdf/photos';
import { distinctPhotos, type LibraryPhoto } from './library';

/**
 * Every photograph on a job, under the caller's RLS (README R173).
 *
 * Two sources, the same as the weekly's gathering (`weekly/photos.ts`) plus the crew's:
 *   - the diary — each day's own photographs and the ones on its variations, dayworks, instructions
 *     and concrete dockets; the CURRENT version of a day only, a corrected day showing the correction,
 *     drafts included and marked;
 *   - `day_photos` — what the crew added to a day (README R172). One that the supervisor has carried
 *     onto the day is the same file, so it falls together with the diary's by path.
 *
 * Nothing here is a copy: the library lists the record's own files and signs links to them for the
 * hour. A photograph removed from a day's draft is not on the day and is not listed.
 */
type Row = Record<string, unknown>;

export async function loadPhotoLibrary(
  supabase: SupabaseClient,
  projectId: string,
  range: { from?: string; to?: string } = {},
): Promise<LibraryPhoto[]> {
  let query = supabase
    .from('entries')
    .select(
      `id, entry_no, entry_date, status, supersedes_entry_id, created_at,
       photos(url, caption, category, created_at),
       variations(register_seq, description, photo_urls),
       dayworks(description, photo_urls),
       site_events(said_text, photo_urls),
       pours(location, docket_photo_urls)`,
    )
    .eq('project_id', projectId);
  if (range.from) query = query.gte('entry_date', range.from);
  if (range.to) query = query.lte('entry_date', range.to);
  const { data } = await query.order('entry_date').order('created_at');
  const rows = (data ?? []) as Row[];
  const superseded = new Set(rows.map((r) => r.supersedes_entry_id as string | null).filter(Boolean));
  const current = rows.filter((r) => !superseded.has(r.id as string));

  const out: LibraryPhoto[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  for (const entry of current) {
    const base = { date: String(entry.entry_date), entryNo: (entry.entry_no as string | null) ?? null, day: entry.status === 'signed' ? ('signed' as const) : ('draft' as const), source: 'diary' as const, by: null };
    for (const v of list(entry.variations)) {
      const seq = v.register_seq as number | null;
      const context = seq == null ? 'Variation' : `Variation V-${String(seq).padStart(3, '0')}`;
      for (const path of (v.photo_urls as string[] | null) ?? []) out.push({ ...base, path, context, caption: (v.description as string | null) ?? null });
    }
    for (const d of list(entry.dayworks)) {
      for (const path of (d.photo_urls as string[] | null) ?? []) out.push({ ...base, path, context: 'Dayworks', caption: (d.description as string | null) ?? null });
    }
    for (const ev of list(entry.site_events)) {
      for (const path of (ev.photo_urls as string[] | null) ?? []) out.push({ ...base, path, context: 'Instruction or event', caption: (ev.said_text as string | null) ?? null });
    }
    for (const p of list(entry.pours)) {
      for (const path of (p.docket_photo_urls as string[] | null) ?? []) out.push({ ...base, path, context: `Concrete docket — ${(p.location as string | null) ?? 'pour'}`, caption: null });
    }
    const own = list(entry.photos).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const p of own) {
      const category = typeof p.category === 'string' ? p.category : 'general';
      out.push({ ...base, path: p.url as string, context: PHOTO_CONTEXT[category] ?? 'Site photograph', caption: (p.caption as string | null) ?? null });
    }
  }

  // The crew's, by the day they were taken on. Those already on the day fold in by path above.
  let crew = supabase.from('day_photos').select('url, caption, taken_on, added_by, created_at').eq('project_id', projectId);
  if (range.from) crew = crew.gte('taken_on', range.from);
  if (range.to) crew = crew.lte('taken_on', range.to);
  const { data: crewRows } = await crew.order('taken_on').order('created_at');
  const crewList = (crewRows ?? []) as Array<{ url: string; caption: string | null; taken_on: string; added_by: string; created_at: string }>;
  const names = new Map<string, string | null>();
  if (crewList.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(crewList.map((r) => r.added_by))]);
    for (const pr of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(pr.id, pr.full_name);
  }
  const dayOf = new Map(current.map((e) => [String(e.entry_date), e]));
  for (const r of crewList) {
    const day = dayOf.get(r.taken_on);
    out.push({
      date: r.taken_on,
      path: r.url,
      context: 'Progress photograph',
      caption: r.caption,
      entryNo: (day?.entry_no as string | null) ?? null,
      // The day it was taken on, as it stands; the photograph itself is not on that day until the supervisor keeps it there.
      day: day ? (day.status === 'signed' ? 'signed' : 'draft') : 'none',
      source: 'crew',
      by: names.get(r.added_by) ?? null,
    });
  }
  return distinctPhotos(out);
}

/** Signed links for the hour, one call per hundred paths. */
export async function signPhotoUrls(supabase: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  const distinct = [...new Set(paths)];
  for (let i = 0; i < distinct.length; i += 100) {
    const { data } = await supabase.storage.from('entry-photos').createSignedUrls(distinct.slice(i, i + 100), 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  return urls;
}
