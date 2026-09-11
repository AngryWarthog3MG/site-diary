import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoImage } from '@/lib/pdf/docket';
import { PHOTO_BUCKET, PHOTO_CONTEXT } from '@/lib/pdf/photos';

/**
 * The week's photographs, day by day, for the weekly report.
 *
 * Every photograph a day carries — the day's own, and the ones on its
 * variations, dayworks and concrete dockets — embedded as data URIs like the
 * daily docket's appendix, so the weekly stays a document rather than a page
 * of links that expire. The images are re-encoded smaller at print time
 * (`data-shrink` in the renderer): a week can carry forty photographs, and a
 * report a PM emails on should not weigh twenty megabytes.
 *
 * Days are the current version only — a corrected day shows the correction —
 * and drafts are included when the report includes them, marked as such.
 */
export interface WeeklyPhotoDay {
  date: string;
  entry_no: string | null;
  signed: boolean;
  photos: PhotoImage[];
}

export interface WeeklyPhotos {
  days: WeeklyPhotoDay[];
  /** Photographs beyond the cap, left in the daily dockets. */
  omitted: number;
  total: number;
}

/** Enough for a week's evidence; anything beyond it is in the daily dockets. */
export const MAX_WEEKLY_PHOTOS = 80;

type Row = Record<string, unknown>;

export async function loadWeeklyPhotos(
  supabase: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options: { includeUnsigned?: boolean } = {},
): Promise<WeeklyPhotos> {
  const { data } = await supabase
    .from('entries')
    .select(
      `id, entry_no, entry_date, status, supersedes_entry_id, created_at,
       photos(url, caption, category, created_at),
       variations(register_seq, description, photo_urls),
       dayworks(description, photo_urls),
       pours(location, docket_photo_urls)`,
    )
    .eq('project_id', projectId)
    .gte('entry_date', start)
    .lte('entry_date', end)
    .order('entry_date')
    .order('created_at');
  const rows = (data ?? []) as Row[];
  const superseded = new Set(rows.map((r) => r.supersedes_entry_id as string | null).filter(Boolean));
  const current = rows.filter(
    (r) => !superseded.has(r.id as string) && (options.includeUnsigned || r.status === 'signed'),
  );

  const wanted: Array<{ day: WeeklyPhotoDay; path: string; context: string; caption: string | null }> = [];
  const days: WeeklyPhotoDay[] = [];
  for (const entry of current) {
    const day: WeeklyPhotoDay = {
      date: String(entry.entry_date),
      entry_no: (entry.entry_no as string | null) ?? null,
      signed: entry.status === 'signed',
      photos: [],
    };
    const list = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
    for (const v of list(entry.variations)) {
      const seq = v.register_seq as number | null;
      const ctx = seq == null ? 'Variation' : `Variation V-${String(seq).padStart(3, '0')}`;
      for (const path of (v.photo_urls as string[] | null) ?? []) wanted.push({ day, path, context: ctx, caption: (v.description as string | null) ?? null });
    }
    for (const d of list(entry.dayworks)) {
      for (const path of (d.photo_urls as string[] | null) ?? []) wanted.push({ day, path, context: 'Dayworks', caption: (d.description as string | null) ?? null });
    }
    for (const p of list(entry.pours)) {
      for (const path of (p.docket_photo_urls as string[] | null) ?? []) wanted.push({ day, path, context: `Concrete docket — ${(p.location as string | null) ?? 'pour'}`, caption: null });
    }
    const dayPhotos = list(entry.photos).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const p of dayPhotos) {
      const category = typeof p.category === 'string' ? p.category : 'general';
      wanted.push({ day, path: p.url as string, context: PHOTO_CONTEXT[category] ?? 'Site photograph', caption: (p.caption as string | null) ?? null });
    }
    days.push(day);
  }

  // One print per photograph per day. A photo taken on a daywork is also the
  // day's photo (same file, both places); the daily appendix lists it under
  // each, the weekly shows it once, with the item it belongs to.
  const seen = new Set<string>();
  const distinct = wanted.filter((w) => {
    const key = `${w.day.date}:${w.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const total = distinct.length;
  const take = distinct.slice(0, MAX_WEEKLY_PHOTOS);
  for (const item of take) {
    const { data: file } = await supabase.storage.from(PHOTO_BUCKET).download(item.path);
    if (!file) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
    item.day.photos.push({ src: `data:${type};base64,${bytes.toString('base64')}`, caption: item.caption, context: item.context });
  }
  return { days: days.filter((d) => d.photos.length > 0), omitted: total - take.length, total };
}
