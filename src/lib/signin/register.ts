/**
 * The day's sign-in register, as facts: who is on site now, who has left,
 * and how a time prints. Pure, so the screen, the PDF and the Home line
 * agree without asking the database twice.
 */

export const PERSON_KINDS = ['crew', 'subcontractor', 'visitor', 'delivery'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

export const KIND_LABEL: Record<PersonKind, string> = {
  crew: 'Crew',
  subcontractor: 'Subcontractor',
  visitor: 'Visitor',
  delivery: 'Delivery',
};

export interface SignInRow {
  id: string;
  person_name: string;
  company: string | null;
  person_kind: PersonKind;
  inducted: boolean | null;
  signed_in_at: string;
  signed_in_on_device_at: string;
  signed_out_at: string | null;
  signed_out_on_device_at: string | null;
}

/** "07:12" in AWST from an ISO instant. Perth has no daylight saving; +8 is fixed. */
export function awstClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The phone's time is the event; the arrival is only noted when it disagrees. */
export function eventClock(onDevice: string | null | undefined, arrival: string | null | undefined): string {
  if (!onDevice) return awstClock(arrival);
  if (!arrival) return awstClock(onDevice);
  if (Math.abs(Date.parse(onDevice) - Date.parse(arrival)) < 2 * 60 * 1000) return awstClock(arrival);
  return `${awstClock(onDevice)} (sent ${awstClock(arrival)})`;
}

export interface DaySplit<T extends SignInRow> {
  onSite: T[];
  left: T[];
}

/** Who is still on site and who has gone, each in the order they arrived. */
export function splitDay<T extends SignInRow>(rows: readonly T[]): DaySplit<T> {
  const byArrival = (a: T, b: T) => a.signed_in_on_device_at.localeCompare(b.signed_in_on_device_at);
  return {
    onSite: rows.filter((r) => r.signed_out_at == null).sort(byArrival),
    left: rows.filter((r) => r.signed_out_at != null).sort(byArrival),
  };
}

/** Hours between in and out, to the quarter hour, or null while still on site. */
export function hoursOnSite(row: SignInRow): number | null {
  const out = row.signed_out_on_device_at ?? row.signed_out_at;
  if (!out) return null;
  const mins = (Date.parse(out) - Date.parse(row.signed_in_on_device_at)) / 60000;
  if (!Number.isFinite(mins) || mins < 0) return null;
  return Math.round(mins / 15) / 4;
}
