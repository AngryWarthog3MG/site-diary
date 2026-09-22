/**
 * The programme (README R95): the construction programme as issued and the
 * two-week look-aheads. Which upload is current, how a fortnight is named,
 * where the next one starts. Pure, relative imports only — node-tested.
 */

export type ProgrammeKind = 'baseline' | 'lookahead';

export interface Programme {
  id: string;
  kind: ProgrammeKind;
  title: string;
  revision: string | null;
  issued_on: string | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  file_path: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

/** A look-ahead covers a fortnight: the start day and thirteen more. */
export const LOOKAHEAD_DAYS = 14;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar arithmetic on YYYY-MM-DD, no zones. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function lookaheadEnd(start: string): string {
  return addDays(start, LOOKAHEAD_DAYS - 1);
}

/** The Monday of the week holding this day (a Sunday belongs to the week before it). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function live<T extends Pick<Programme, 'voided_at'>>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.voided_at == null);
}

const byIssued = (a: Programme, b: Programme) =>
  (b.issued_on ?? '').localeCompare(a.issued_on ?? '') || b.created_at.localeCompare(a.created_at);

/** The construction programme in force: the newest issued baseline still live; the newest uploaded among ties. */
export function currentBaseline(rows: readonly Programme[]): Programme | null {
  const b = live(rows).filter((r) => r.kind === 'baseline').sort(byIssued);
  return b[0] ?? null;
}

/** Every live baseline, newest first — the revisions behind the current one. */
export function baselines(rows: readonly Programme[]): Programme[] {
  return live(rows).filter((r) => r.kind === 'baseline').sort(byIssued);
}

/** Live look-aheads, the latest fortnight first. */
export function lookaheads(rows: readonly Programme[]): Programme[] {
  return live(rows)
    .filter((r) => r.kind === 'lookahead')
    .sort((a, b) => (b.period_start ?? '').localeCompare(a.period_start ?? '') || b.created_at.localeCompare(a.created_at));
}

/** The look-ahead whose fortnight holds today, if one was uploaded (the newest upload wins). */
export function currentLookahead(rows: readonly Programme[], today: string): Programme | null {
  return lookaheads(rows).find((r) => r.period_start != null && r.period_end != null && r.period_start <= today && today <= r.period_end) ?? null;
}

/**
 * Where the next look-ahead starts: the day after the latest fortnight on
 * file, or this week's Monday when there is none — and never in the past,
 * so a job that lapsed picks up from this week.
 */
export function nextLookaheadStart(rows: readonly Programme[], today: string): string {
  const latest = lookaheads(rows)[0];
  const thisWeek = mondayOf(today);
  if (!latest?.period_end) return thisWeek;
  const after = addDays(latest.period_end, 1);
  return after > thisWeek ? after : thisWeek;
}

/** "21 Sep – 4 Oct 2026"; the year once, unless the fortnight straddles it. */
export function periodLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const s = `${sd} ${MONTHS[sm - 1]}${sy !== ey ? ` ${sy}` : ''}`;
  return `${s} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "PDF · 1.2 MB" — what the file is, from what the browser said it was. */
export function fileLabel(contentType: string | null | undefined, sizeBytes: number | null | undefined, path?: string): string {
  const ext = (path ?? '').split('.').pop()?.toLowerCase() ?? '';
  const kind = contentType === 'application/pdf' ? 'PDF'
    : contentType?.startsWith('image/') ? 'Image'
    : /spreadsheet|ms-excel/.test(contentType ?? '') || ext === 'xlsx' || ext === 'xls' ? 'Spreadsheet'
    : contentType === 'text/csv' || ext === 'csv' ? 'CSV'
    : ext === 'mpp' || contentType === 'application/vnd.ms-project' ? 'MS Project'
    : ext ? ext.toUpperCase() : 'File';
  if (sizeBytes == null) return kind;
  const mb = sizeBytes / 1048576;
  return `${kind} · ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`}`;
}
