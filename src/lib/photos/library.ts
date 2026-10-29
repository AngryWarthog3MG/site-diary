/**
 * The job's photo library (README R173): every photograph taken on the job, in one place, by the day
 * it was taken — and the same list named into the dated folders of a download.
 *
 * Pure. The loader (`library-load.ts`) gathers the rows; this file decides the order, the grouping
 * and the names. Relative imports only — Node-tested.
 */

export type PhotoSource = 'diary' | 'crew';
/** Where the day's diary stands: signed (the record), a draft, or no diary for that day at all. */
export type DayStanding = 'signed' | 'draft' | 'none';

export interface LibraryPhoto {
  /** The day the photograph belongs to (YYYY-MM-DD, Perth). */
  date: string;
  /** Storage path in `entry-photos`. */
  path: string;
  /** Where on the day it sits: "Site photograph", "Dayworks", "Variation V-003", … */
  context: string;
  caption: string | null;
  /** The day's serial — issued at signing, so a draft has none. */
  entryNo: string | null;
  /** The day the photograph is on. A photograph on a signed day is part of the record. */
  day: DayStanding;
  /** `diary`: on the day's record. `crew`: added by the crew (README R172), not yet carried onto a day. */
  source: PhotoSource;
  /** Who added it, where the row says (the crew's photographs). */
  by: string | null;
}

export interface LibraryDay {
  date: string;
  entryNo: string | null;
  day: DayStanding;
  photos: LibraryPhoto[];
}

const RANK: Record<DayStanding, number> = { none: 0, draft: 1, signed: 2 };

export interface LibraryMonth {
  /** YYYY-MM */
  month: string;
  days: LibraryDay[];
  count: number;
}

/** One line per photograph per day: a daywork's photograph is also the day's, and prints once. */
export function distinctPhotos(photos: LibraryPhoto[]): LibraryPhoto[] {
  const seen = new Set<string>();
  const out: LibraryPhoto[] = [];
  for (const p of photos) {
    const key = `${p.date}\n${p.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Newest day first on screen; within a day, the order the day lists them. */
export function groupByDay(photos: LibraryPhoto[]): LibraryDay[] {
  const days = new Map<string, LibraryDay>();
  for (const p of distinctPhotos(photos)) {
    let day = days.get(p.date);
    if (!day) {
      day = { date: p.date, entryNo: p.entryNo, day: p.day, photos: [] };
      days.set(p.date, day);
    }
    if (!day.entryNo && p.entryNo) day.entryNo = p.entryNo;
    if (RANK[p.day] > RANK[day.day]) day.day = p.day;
    day.photos.push(p);
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function groupByMonth(days: LibraryDay[]): LibraryMonth[] {
  const months = new Map<string, LibraryMonth>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { month: key, days: [], count: 0 };
      months.set(key, m);
    }
    m.days.push(d);
    m.count += d.photos.length;
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Characters a file name cannot carry on a phone, a Mac or Windows, and runs of space. */
function safeName(text: string, max: number): string {
  const cleaned = text
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trimEnd() + '…';
}

function extensionOf(path: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path);
  return m ? m[1].toLowerCase() : 'jpg';
}

/**
 * The folder tree of the download: `{job} photographs/{date}/{date} {nn} {context} - {caption}.jpg`.
 * The date is in the folder AND the name, so a photograph copied out of its folder still says when it was taken.
 * Numbered within the day in the day's own order, so the names are stable for the same day.
 */
export function zipEntries(jobCode: string, days: LibraryDay[]): Array<{ name: string; photo: LibraryPhoto }> {
  const root = `${safeName(jobCode, 40)} photographs`;
  const out: Array<{ name: string; photo: LibraryPhoto }> = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    day.photos.forEach((photo, i) => {
      const nn = String(i + 1).padStart(2, '0');
      const tail = photo.caption ? ` - ${safeName(photo.caption, 60)}` : '';
      const mark = photo.source === 'crew' ? ' (crew, not yet on the day)' : photo.day === 'signed' ? '' : ' (draft)';
      out.push({ name: `${root}/${day.date}/${day.date} ${nn} ${safeName(photo.context, 40)}${tail}${mark}.${extensionOf(photo.path)}`, photo });
    });
  }
  return out;
}

/** The first and last day of a month (YYYY-MM): "2026-09" → 2026-09-01 to 2026-09-30. A made-up 31st is not a date. */
export function monthRange(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error('month must be YYYY-MM');
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** The download's own name. */
export function zipFileName(jobCode: string, month: string | null): string {
  return `${safeName(jobCode, 40)} photographs${month ? ` ${month}` : ''}.zip`;
}
