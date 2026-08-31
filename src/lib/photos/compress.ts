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
 */

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;
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
