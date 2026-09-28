/**
 * Client-side photo compression before upload.
 *
 * A modern phone camera produces 4–8 MB per shot; on one bar of signal at the
 * back of a site that is a minute per photo, and the docket needs legibility,
 * not 48 megapixels. Downscale to a sensible bound and re-encode as JPEG —
 * which also normalises iPhone HEIC into something every viewer can open.
 *
 * Fail open, always: any decode or encode problem returns the original file.
 * A photo uploaded big is a nuisance; a photo not uploaded is a hole in the
 * evidence.
 *
 * The size chosen here is the size the record keeps for good (README R113):
 * the signed docket embeds the photograph byte for byte, the monthly bundle
 * binds the dockets, and none of that is ever re-encoded. At 1920 px and 0.82
 * a site photograph stored at 0.9–1.3 MB and a docket with seventeen of them
 * weighed 27 MB; at 1600 px and 0.78 the same photographs store at 0.35–0.55 MB
 * — about 40 % of the bytes — and 1600 px is still more than an A4 page prints
 * (a two-up photograph on the docket is about 1060 px wide at 300 dpi). Measured on the
 * app's own canvas path against stored photographs, 28/09/2026.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.78;
/** Below this size, recompression saves nothing worth the CPU. */
const SKIP_BELOW_BYTES = 400_000;

export interface CompressedPhoto {
  blob: Blob;
  contentType: string;
  extension: string;
}

function asOriginal(file: File): CompressedPhoto {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  return { blob: file, contentType: file.type || 'image/jpeg', extension };
}

export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  if (file.size < SKIP_BELOW_BYTES && !/hei[cf]/i.test(file.type)) {
    return asOriginal(file);
  }

  try {
    // from-image applies the EXIF orientation, so a portrait shot does not
    // land sideways in the record.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return asOriginal(file);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size === 0) return asOriginal(file);

    // Keep the original if compression somehow made it bigger (already-tiny
    // JPEGs can) — unless the original was HEIC, where compatibility wins.
    if (blob.size >= file.size && !/hei[cf]/i.test(file.type)) return asOriginal(file);

    return { blob, contentType: 'image/jpeg', extension: 'jpg' };
  } catch {
    return asOriginal(file);
  }
}
