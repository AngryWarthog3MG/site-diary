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
  /** How it was signed (README R125): on paper and recorded afterwards, or drawn on the screen. */
  signed_how?: 'paper' | 'on_screen';
  /** The drawn signature, in bucket 'dayworks-signoffs'. */
  signature_path?: string | null;
  /** The words above the signature when it was given. */
  declaration?: string | null;
  signed_at?: string | null;
  /** The lines it was given for, as they read then. Null on a sign-off recorded before lines were kept. */
  lines?: SignedLine[] | null;
}

/** One daywork as a sign-off holds it. */
export interface SignedLine {
  date: string;
  works: string;
  hours: number | null;
  docket: string | null;
  labour: string | null;
  plant: string | null;
  materials: string | null;
}
type LineLike = Pick<SignedLine, 'date' | 'works' | 'hours'> & Partial<SignedLine>;

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

// ---------------------------------------------------------------------------
// Approval, line by line (README R125)
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const tidy = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * What makes a daywork the same daywork: its day, its works and its hours. A line corrected afterwards — the works
 * reworded, the hours changed — is a different line, and what the client signed for no longer covers it.
 */
export function lineKey(l: Pick<SignedLine, 'date' | 'works' | 'hours'>): string {
  return `${l.date}|${tidy(l.works)}|${l.hours == null ? '' : round2(l.hours)}`;
}

/** The lines as a sign-off keeps them: only what was on the sheet, nothing that can change under it. */
export function snapshotLines(lines: readonly LineLike[]): SignedLine[] {
  return lines.map((l) => ({
    date: l.date, works: l.works.trim(), hours: l.hours == null ? null : round2(l.hours),
    docket: l.docket ?? null, labour: l.labour ?? null, plant: l.plant ?? null, materials: l.materials ?? null,
  }));
}

export interface Approval {
  /** Beside each line given, in the same order: the sign-off that holds it, or null while it waits. */
  by: Array<DayworkSignoff | null>;
  approved: number;
  approvedHours: number;
  awaiting: number;
  awaitingHours: number;
  /** Lines waiting that have no hours recorded — counted, never added as zero. */
  awaitingNoHours: number;
  state: 'nothing' | 'approved' | 'part' | 'awaiting';
}

/**
 * Which of these dayworks the client has signed for. A line is approved when a sign-off holds a line with the same
 * day, works and hours; the earliest signature is the approval. Two identical lines need two signatures' worth — a
 * sign-off that held one of them approves one. A sign-off with no lines kept approves nothing here: it is still on
 * the job's list, with what it said.
 */
export function approvalOf(lines: readonly LineLike[], signoffs: readonly DayworkSignoff[]): Approval {
  const slots = new Map<string, DayworkSignoff[]>();
  const earliestFirst = signoffs.slice().sort((a, b) => a.signed_on.localeCompare(b.signed_on) || (a.signed_at ?? '').localeCompare(b.signed_at ?? ''));
  for (const s of earliestFirst) {
    for (const l of s.lines ?? []) {
      const key = lineKey(l);
      const held = slots.get(key);
      if (held) held.push(s); else slots.set(key, [s]);
    }
  }
  const by: Array<DayworkSignoff | null> = lines.map((l) => slots.get(lineKey(l))?.shift() ?? null);
  let approved = 0; let approvedHours = 0; let awaiting = 0; let awaitingHours = 0; let awaitingNoHours = 0;
  lines.forEach((l, i) => {
    if (by[i]) { approved += 1; approvedHours = round2(approvedHours + (l.hours ?? 0)); }
    else { awaiting += 1; if (l.hours == null) awaitingNoHours += 1; else awaitingHours = round2(awaitingHours + l.hours); }
  });
  const state: Approval['state'] = lines.length === 0 ? 'nothing' : awaiting === 0 ? 'approved' : approved === 0 ? 'awaiting' : 'part';
  return { by, approved, approvedHours, awaiting, awaitingHours, awaitingNoHours, state };
}

/**
 * The words the client signs under on the screen — the sheet's own (README R83): what a signature acknowledges, and
 * what it leaves to the contract. Kept with the signature, so what was agreed to is on the record beside it.
 */
export function declarationText(client: string, items: number): string {
  const who = client.trim() || 'the head contractor';
  return `For signature by ${who}. The ${items} item${items === 1 ? '' : 's'} of work listed ${items === 1 ? 'was' : 'were'} carried out on the dates shown, with the labour, plant and materials recorded against ${items === 1 ? 'it' : 'each'}. Signing acknowledges the labour, plant and materials expended. Rates, entitlement and value are dealt with under the contract.`;
}

/** Item numbers as a reader says them: 1–6, 8, 10–11. */
export function itemRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j === i ? String(sorted[i]) : j === i + 1 ? `${sorted[i]}, ${sorted[j]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/** Where a drawn signature is filed: beside the countersigned sheets, under its own job and sign-off. */
export function signaturePath(projectId: string, signoffId: string): string {
  return `${projectId}/${signoffId}.png`;
}
