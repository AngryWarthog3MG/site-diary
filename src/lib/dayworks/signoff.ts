/**
 * A dayworks sheet the head contractor signed (README R86).
 *
 * The sheet goes out, comes back signed, and is recorded here with what it
 * covered at the time. Two things follow from that, and they are the whole
 * reason this is a record rather than a note:
 *
 *   - It is frozen. What the client put their name to does not change because
 *     a day was corrected afterwards.
 *   - Which means the schedule can drift away from it, and the screen has to
 *     say so. A correction landing after a signature is exactly the case where
 *     a subcontractor thinks he is covered and is not.
 *
 * Pure, relative imports only — node-tested.
 */

export interface DayworkSignoff {
  id: string;
  period_from: string | null;
  period_to: string | null;
  period_label: string;
  items: number;
  hours: number;
  hours_not_recorded: number;
  photos: number;
  signed_by_name: string;
  signed_by_position: string | null;
  signed_on: string;
  file_path: string | null;
  note: string | null;
}

export interface Period {
  from: string | null;
  to: string | null;
}

const same = (a: string | null, b: string | null) => (a ?? '') === (b ?? '');

/** The sign-off recorded for exactly this period, latest signature first. */
export function signoffFor(list: readonly DayworkSignoff[], period: Period): DayworkSignoff | null {
  const hits = list.filter((s) => same(s.period_from, period.from) && same(s.period_to, period.to));
  if (hits.length === 0) return null;
  return hits.slice().sort((a, b) => b.signed_on.localeCompare(a.signed_on))[0];
}

export interface Drift {
  items: number;
  hours: number;
}

/**
 * What has changed on the schedule since it was signed. Null when it still
 * reads the way the client saw it — which is the answer you want.
 *
 * Deliberately only the two figures a claim turns on. A photograph added
 * afterwards is not a change to what was agreed.
 */
export function driftFrom(signoff: Pick<DayworkSignoff, 'items' | 'hours'>, now: { items: number; hours: number }): Drift | null {
  const items = now.items - signoff.items;
  const hours = Math.round((now.hours - signoff.hours) * 100) / 100;
  return items === 0 && hours === 0 ? null : { items, hours };
}

/** "2 items and 10 hours more than when it was signed" — the one line on screen. */
export function driftText(drift: Drift): string {
  const bit = (n: number, one: string, many: string) => `${Math.abs(n)} ${Math.abs(n) === 1 ? one : many}`;
  const parts: string[] = [];
  if (drift.items !== 0) parts.push(bit(drift.items, 'item', 'items'));
  if (drift.hours !== 0) parts.push(bit(drift.hours, 'hour', 'hours'));
  const direction = (drift.items || drift.hours) > 0 ? 'more than' : 'fewer than';
  return `${parts.join(' and ')} ${direction} when it was signed`;
}

/** The file's path for a sign-off that has not been recorded yet. */
export function signoffPath(projectId: string, signoffId: string, fileName: string): string {
  const ext = (fileName.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  return `${projectId}/${signoffId}.${ext}`;
}
