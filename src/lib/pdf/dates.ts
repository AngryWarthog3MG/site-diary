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
