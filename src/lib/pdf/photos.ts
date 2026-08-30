import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoImage } from './docket';
import type { DocketEntry } from './load';

/**
 * Collect the entry's photographs for the appendix.
 *
 * Embedded as data URIs rather than linked. A PDF that reaches for a bucket
 * every time it is opened is not an archival document — the link expires, the
 * bucket moves, and the evidence for a variation claim goes with it.
 */
export async function collectPhotos(
  supabase: SupabaseClient,
  entry: DocketEntry,
): Promise<PhotoImage[]> {
  const wanted: Array<{ bucket: string; path: string; context: string; caption: string | null }> =
    [];

  entry.variations.forEach((variation, index) => {
    for (const path of (variation.photo_urls as string[] | null) ?? []) {
      wanted.push({
        bucket: 'entry-photos',
        path,
        context: `Variation ${(variation.vr_ref as string | null) ?? index + 1}`,
        caption: null,
      });
    }
  });

  entry.pours.forEach((pour, index) => {
    for (const path of (pour.docket_photo_urls as string[] | null) ?? []) {
      wanted.push({
        bucket: 'entry-photos',
        path,
        context: `Concrete docket — ${(pour.location as string | null) ?? `pour ${index + 1}`}`,
        caption: null,
      });
    }
  });

  for (const photo of entry.photos) {
    wanted.push({
      bucket: 'entry-photos',
      path: photo.url as string,
      context: 'Site photograph',
      caption: (photo.caption as string | null) ?? null,
    });
  }

  const images: PhotoImage[] = [];
  for (const item of wanted) {
    const { data } = await supabase.storage.from(item.bucket).download(item.path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    const type = data.type && data.type.startsWith('image/') ? data.type : 'image/jpeg';
    images.push({
      src: `data:${type};base64,${bytes.toString('base64')}`,
      caption: item.caption,
      context: item.context,
    });
  }

  return images;
}
