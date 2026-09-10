/**
 * When a photo was taken, as the record wants it — and never a thrown error.
 *
 * A photo picked from the gallery was taken when the file says it was, not
 * when it was attached; the gap between the two can be a whole shift. But
 * `file.lastModified` is not to be trusted: some phones hand back 0, a string,
 * or nothing at all, and `new Date(garbage).toISOString()` throws RangeError.
 * That throw sat between a successful upload and the photo entering the diary,
 * so the file landed in storage and the day never heard of it. Now a bad
 * timestamp means null — "not stated", never "now": the upload time is not
 * when the photo was taken, and the record does not invent a value — and
 * the photo is kept.
 */
export function photoTakenAt(file: { lastModified?: unknown }): string | null {
  const raw = file.lastModified;
  const ms = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const candidate = new Date(ms);
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : null;
}
