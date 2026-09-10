/**
 * A file in storage that the record does not reference is as good as lost:
 * nobody will ever see it. This decides what to do about each one, from
 * facts alone so it can be tested without a bucket.
 *
 *   attach        — a photo under an unsigned draft: put it back on the day.
 *   unrecoverable — a photo under a signed day, or a drawn signature whose
 *                   name was never saved: report it; the record cannot change.
 *   ignore        — files the app manages by other means (prestart and plant
 *                   folders hold their own references) or that are not photos.
 */
export interface StoredFile { path: string; createdAt: string | null }
export interface EntryFacts { id: string; status: string; project_id: string; entry_date: string }
export type OrphanAction =
  | { kind: 'attach'; path: string; entryId: string; takenAt: string | null }
  | { kind: 'unrecoverable'; path: string; reason: string; entryDate: string | null }
  | { kind: 'ignore'; path: string };

const PHOTO = /\.(jpe?g|png|webp|heic|heif|gif)$/i;

export function classifyOrphan(file: StoredFile, referenced: Set<string>, entries: Map<string, EntryFacts>): OrphanAction {
  if (referenced.has(file.path)) return { kind: 'ignore', path: file.path };
  const [first, second, third] = file.path.split('/');
  if (second === 'prestart' || second === 'plant') return { kind: 'ignore', path: file.path };
  const entry = second ? entries.get(second) : undefined;
  if (!entry || !third) return { kind: 'unrecoverable', path: file.path, reason: 'no entry for this folder', entryDate: null };
  if (entry.project_id !== first) {
    return { kind: 'unrecoverable', path: file.path, reason: 'the folder is not the day\'s own project', entryDate: entry.entry_date };
  }
  if (/^signature-/.test(third)) {
    return { kind: 'unrecoverable', path: file.path, reason: 'a drawn signature whose name was never saved', entryDate: entry.entry_date };
  }
  if (!PHOTO.test(third)) return { kind: 'ignore', path: file.path };
  if (entry.status === 'signed') {
    return { kind: 'unrecoverable', path: file.path, reason: 'the day was signed without it', entryDate: entry.entry_date };
  }
  return { kind: 'attach', path: file.path, entryId: entry.id, takenAt: file.createdAt };
}

export function isRecent(file: StoredFile, now: number, hours = 48): boolean {
  if (!file.createdAt) return false;
  const t = Date.parse(file.createdAt);
  return Number.isFinite(t) && now - t < hours * 3600 * 1000;
}
