import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoImage } from './docket';
import type { DocketEntry } from './load';

export const PHOTO_CONTEXT: Record<string, string> = {
  progress: 'Progress photograph',
  works: 'Works photograph',
  delay: 'Delay photograph',
  variation: 'Variation photograph',
  pour: 'Pour photograph',
  safety: 'Safety photograph',
  general: 'Site photograph',
};

export const PHOTO_BUCKET = 'entry-photos';

export interface PhotoPath {
  bucket: string;
  path: string;
  context: string;
  caption: string | null;
}

/**
 * Every photograph the entry carries, with its caption, in appendix order.
 *
 * ONE list for both renderings of the record: the PDF embeds these paths as
 * data URIs and the screen docket signs URLs for them. The gathering used to
 * be duplicated in the docket page with its own caption map — which promptly
 * drifted (it lost 'progress', the default category, and never learned about
 * dayworks photos), so screen and signed PDF disagreed about the same photo.
 */
export function collectPhotoPaths(entry: DocketEntry): PhotoPath[] {
  const wanted: PhotoPath[] = [];

  entry.variations.forEach((variation, index) => {
    for (const path of (variation.photo_urls as string[] | null) ?? []) {
      wanted.push({
        bucket: PHOTO_BUCKET,
        path,
        context: `Variation ${(variation.vr_ref as string | null) ?? index + 1}`,
        caption: null,
      });
    }
  });

  entry.pours.forEach((pour, index) => {
    for (const path of (pour.docket_photo_urls as string[] | null) ?? []) {
      wanted.push({
        bucket: PHOTO_BUCKET,
        path,
        context: `Concrete docket — ${(pour.location as string | null) ?? `pour ${index + 1}`}`,
        caption: null,
      });
    }
  });

  entry.dayworks.forEach((daywork, index) => {
    for (const path of (daywork.photo_urls as string[] | null) ?? []) {
      wanted.push({
        bucket: PHOTO_BUCKET,
        path,
        context: `Dayworks — ${(daywork.docket_ref as string | null) ?? `item ${index + 1}`}`,
        caption: null,
      });
    }
  });

  for (const photo of entry.photos) {
    const category = typeof photo.category === 'string' ? photo.category : 'general';
    wanted.push({
      bucket: PHOTO_BUCKET,
      path: photo.url as string,
      context: PHOTO_CONTEXT[category] ?? 'Site photograph',
      caption: (photo.caption as string | null) ?? null,
    });
  }

  return wanted;
}

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
  const images: PhotoImage[] = [];
  for (const item of collectPhotoPaths(entry)) {
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


export interface SignatureImage {
  role: string;
  name: string;
  /** data: URI for the PDF; the screen docket substitutes signed URLs. */
  src: string;
}

/** The drawn sign-off marks, embedded the same archival way as photographs. */
export async function collectSignatures(
  supabase: SupabaseClient,
  entry: DocketEntry,
): Promise<SignatureImage[]> {
  const images: SignatureImage[] = [];
  for (const row of entry.signatures ?? []) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).download(row.image_path as string);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    images.push({
      role: String(row.role),
      name: String(row.signatory_name),
      src: `data:image/png;base64,${bytes.toString('base64')}`,
    });
  }
  // Supervisor before client, always — order is part of the layout.
  return images.sort((a, b) => (a.role === 'supervisor' ? -1 : 1) - (b.role === 'supervisor' ? -1 : 1));
}
