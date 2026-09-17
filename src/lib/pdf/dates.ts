/**
 * Dates as people on site read them: DD/MM/YYYY.
 *
 * Storage stays ISO (YYYY-MM-DD) everywhere — sortable, unambiguous, and
 * what every query compares against. Serials such as KBL-2026-09-05 are
 * identifiers, not dates, and are never reformatted. This is the one place
 * the display form is written down; screens and PDFs both use it, so the
 * docket's determinism check covers it too. A leaf with no imports, so the
 * standalone PDF build can take it.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "DD/MM/YYYY to DD/MM/YYYY" for a range. */
export function fmtRange(start: string, end: string): string {
  return `${fmtDate(start)} to ${fmtDate(end)}`;
}

/**
 * The calendar day in Perth of an instant. A timestamp is stored in UTC, and
 * cutting its first ten characters gives the UTC day: anything between midnight
 * and 8 am in Perth then shows as the day before, beside a Perth clock time that
 * says otherwise. Perth has no daylight saving, so adding eight hours is exact —
 * and it is arithmetic, not the locale, so a PDF renders the same everywhere.
 * A bare date (YYYY-MM-DD) is already a calendar day and passes through.
 */
export function perthDate(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  return new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** DD/MM/YYYY of an instant, on Perth's calendar. */
export function fmtPerthDate(iso: string | null | undefined): string {
  return iso ? fmtDate(perthDate(iso)) : '—';
}
