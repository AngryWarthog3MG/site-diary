import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_BUCKET } from '@/lib/pdf/photos';
import type { DayworkLine } from './schedule';

/**
 * The photographs on each daywork item, for the client sign-off sheet.
 *
 * Embedded as data URIs like the docket's appendix, so what the client signs
 * is a document rather than a page of links that expire, and shrunk to the
 * sheet's size before they reach the browser (README R139; the renderer would
 * shrink them too, a hundred times slower) — a month of dayworks carries a lot
 * of photographs and a sheet emailed to a PM should not weigh twenty megabytes.
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

/** The longest side a photograph is printed at on the sheet: legible evidence, small enough to email (owner, 2026-09-18). */
export const SIGNOFF_IMAGE_MAX = 900;

/** How many photographs are fetched and shrunk at once. */
const PARALLEL = 6;

/**
 * A stored photograph shrunk to the sheet's size HERE, before it reaches Chromium (README R139): the 1600 px original
 * costs the browser a decode and a canvas each, a hundred times over, and the whole-job sheet took three minutes. Sharp
 * honours the EXIF orientation as the browser did. If it cannot read the file, the original goes through as before and
 * the renderer shrinks it.
 */
async function shrunk(bytes: Buffer, type: string, max: number): Promise<{ bytes: Buffer; type: string }> {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(bytes).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return { bytes: out, type: 'image/jpeg' };
  } catch {
    return { bytes, type };
  }
}

/**
 * `lines` in schedule order — the item number is the line's place in it,
 * which is what the sheet prints beside each row.
 */
export async function loadDayworkPhotos(
  supabase: SupabaseClient,
  lines: Array<Pick<DayworkLine, 'dayworkId'>>,
  cap = MAX_SIGNOFF_PHOTOS,
  max = SIGNOFF_IMAGE_MAX,
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
  // Fetched and shrunk a few at a time; kept in schedule order whatever order they arrive in.
  const got: Array<string | null> = new Array(take.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < take.length) {
      const i = next++;
      const { data: file } = await supabase.storage.from(PHOTO_BUCKET).download(take[i].path);
      if (!file) continue;
      const raw = Buffer.from(await file.arrayBuffer());
      const type = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
      const small = await shrunk(raw, type, max);
      got[i] = `data:${small.type};base64,${small.bytes.toString('base64')}`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, take.length) }, worker));
  take.forEach(({ item }, i) => {
    const src = got[i];
    if (!src) return;
    const list = byItem.get(item) ?? [];
    list.push(src);
    byItem.set(item, list);
  });
  return { byItem, omitted: wanted.length - take.length, total: wanted.length };
}
