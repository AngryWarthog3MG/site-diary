import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_BUCKET } from '@/lib/pdf/photos';
import type { DayworkLine } from './schedule';

/**
 * The photographs on each daywork item, for the client sign-off sheet.
 *
 * Embedded as data URIs like the docket's appendix, so what the client signs
 * is a document rather than a page of links that expire, and re-encoded
 * smaller at print time (`data-shrink` in the renderer) — a month of dayworks
 * carries a lot of photographs and a sheet emailed to a PM should not weigh
 * twenty megabytes.
 *
 * Only what the caller may read: the fetch runs under their RLS, so a
 * labourer's export cannot pull photographs the screen would refuse them.
 */
export interface DayworkPhoto {
  /** data: URI. */
  src: string;
  /** The item number on the schedule this photograph belongs to. */
  item: number;
}

export interface DayworkPhotos {
  byItem: Map<number, string[]>;
  /** Photographs past the cap, left in the daily dockets. */
  omitted: number;
  total: number;
}

/** Enough evidence for a claim; past it, the period is too long for one sheet. */
export const MAX_SIGNOFF_PHOTOS = 100;

/**
 * `lines` in schedule order — the item number is the line's place in it,
 * which is what the sheet prints beside each row.
 */
export async function loadDayworkPhotos(
  supabase: SupabaseClient,
  lines: Array<Pick<DayworkLine, 'dayworkId'>>,
  cap = MAX_SIGNOFF_PHOTOS,
): Promise<DayworkPhotos> {
  const byItem = new Map<number, string[]>();
  const ids = lines.map((l) => l.dayworkId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { byItem, omitted: 0, total: 0 };

  const { data } = await supabase.from('dayworks').select('id, photo_urls').in('id', ids);
  const paths = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{ id: string; photo_urls: string[] | null }>) {
    paths.set(row.id, row.photo_urls ?? []);
  }

  // In schedule order, so the cap keeps the earliest items whole rather than
  // taking a scattering from everywhere.
  const wanted: Array<{ item: number; path: string }> = [];
  lines.forEach((line, index) => {
    for (const path of paths.get(line.dayworkId ?? '') ?? []) wanted.push({ item: index + 1, path });
  });

  const take = wanted.slice(0, cap);
  for (const { item, path } of take) {
    const { data: file } = await supabase.storage.from(PHOTO_BUCKET).download(path);
    if (!file) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
    const list = byItem.get(item) ?? [];
    list.push(`data:${type};base64,${bytes.toString('base64')}`);
    byItem.set(item, list);
  }
  return { byItem, omitted: wanted.length - take.length, total: wanted.length };
}
