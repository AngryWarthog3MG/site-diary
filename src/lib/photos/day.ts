/**
 * Progress photographs from the crew (README R172), pure: where a photo lives and the day it belongs to. The path is
 * the job's and the day's — `{project}/day/{date}/{id}.{ext}` — not an entry's, because a photo taken at 7 am has no
 * draft to land on yet; the review screen puts it on the day's draft when there is one. Dependency-free, node-tested.
 */

export const DAY_PHOTO_FOLDER = 'day';

export function dayPhotoPath(projectId: string, takenOn: string, id: string, extension: string): string {
  return `${projectId}/${DAY_PHOTO_FOLDER}/${takenOn}/${id}.${extension.replace(/^\./, '') || 'jpg'}`;
}

/** The device's own date, YYYY-MM-DD — "today" on site, never the server's (a Perth evening is already tomorrow in UTC). */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0'); const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DayPhotoRow { url: string; caption: string | null; taken_at: string | null }
export interface DayPhotoOnPayload { url: string; caption: string | null; category: 'progress'; taken_at: string | null; lat: null; lng: null }

/**
 * The crew's photographs not yet offered to the draft, as payload photos. `offered` is every url the screen has already
 * put on the day or seen there — so a photograph the supervisor took off stays off, and one is never added twice.
 */
export function freshDayPhotos(rows: readonly DayPhotoRow[], offered: ReadonlySet<string>): DayPhotoOnPayload[] {
  const out: DayPhotoOnPayload[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.url || offered.has(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({ url: r.url, caption: r.caption?.trim() || null, category: 'progress', taken_at: r.taken_at ?? null, lat: null, lng: null });
  }
  return out;
}
