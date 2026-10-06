/**
 * The people on a daywork and their own hours (README R129), as text. A dependency-free leaf so the docket template
 * can print it: "Matthew Rodgers 6.5 h, Evan Burke 6.5 h", with "hours not recorded" where a person's figure is
 * missing — never a share of a total.
 */
export interface LabourRow { person_name: string; hours: number | null }

export function readLabourRows(value: unknown): LabourRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      const o = (v ?? {}) as { person_name?: unknown; hours?: unknown };
      const name = typeof o.person_name === 'string' ? o.person_name.trim() : '';
      const h = o.hours == null || o.hours === '' ? null : Number(o.hours);
      return { person_name: name, hours: h != null && Number.isFinite(h) ? h : null };
    })
    .filter((r) => r.person_name !== '');
}

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export function labourRowsText(rows: readonly LabourRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.map((r) => `${r.person_name} ${r.hours == null ? '(hours not recorded)' : `${fmtHours(r.hours)} h`}`).join(', ');
}

/** The daywork's hours when every person has theirs: their sum. Otherwise null — the typed figure stands. */
export function labourRowsTotal(rows: readonly LabourRow[]): number | null {
  if (rows.length === 0 || rows.some((r) => r.hours == null)) return null;
  return Math.round(rows.reduce((t, r) => t + (r.hours ?? 0), 0) * 100) / 100;
}
