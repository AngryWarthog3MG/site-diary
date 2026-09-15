/**
 * The variation register's vocabulary and arithmetic, kept pure so the screen
 * and the tests agree on what "not yet submitted" means.
 */

export const VARIATION_STATUSES = ['raised', 'priced', 'submitted', 'approved', 'rejected', 'paid'] as const;
export type VariationStatus = (typeof VARIATION_STATUSES)[number];

export const STATUS_LABEL: Record<VariationStatus, string> = {
  raised: 'Raised',
  priced: 'Priced',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};

export const STATUS_HINT: Record<VariationStatus, string> = {
  raised: 'Directed on site; nothing sent yet',
  priced: 'Costed, not yet sent to the client',
  submitted: 'With the client, waiting on a decision',
  approved: 'Agreed — invoice it',
  rejected: 'Refused by the client',
  paid: 'Money received',
};

/** Statuses where the money has not yet been asked for. */
export const NOT_SUBMITTED: readonly VariationStatus[] = ['raised', 'priced'];

export interface RegisterItem {
  id: string;
  /** The project's running number, issued when the item was created. */
  seq: number;
  title: string;
  vr_ref: string | null;
  raised_on: string;
  status: VariationStatus;
  estimated_cost: number | null;
  agreed_cost: number | null;
  submitted_on: string | null;
  decided_on: string | null;
  paid_on: string | null;
  notes: string | null;
  /** The diary days that mention it, earliest first. A draft has no serial yet. */
  mentions: Array<{ date: string; entry_no: string | null; entry_id: string; signed: boolean; hours: number | null; description: string | null; crew: string[] }>;
  /** Every status change, oldest first: who moved it, when, and what they noted. */
  events: Array<{ status: VariationStatus; note: string | null; at: string; by: string | null }>;
  /** Whether any signed diary records it. Until then it is provisional. */
  signed: boolean;
  /** Everyone named on it across its days. */
  crew: string[];
  /** Hours the days stated, added up. A day that stated none adds nothing. */
  hours: number;
}

/** V-007: how a register number reads on screen and in a conversation. */
export function registerNumber(seq: number): string {
  return `V-${String(seq).padStart(3, '0')}`;
}

/** The value a variation is worth as far as anyone has said: agreed, else estimated. */
export function itemValue(item: Pick<RegisterItem, 'estimated_cost' | 'agreed_cost'>): number | null {
  return item.agreed_cost ?? item.estimated_cost ?? null;
}

export interface RegisterSummary {
  byStatus: Array<{ status: VariationStatus; count: number; value: number }>;
  notSubmitted: { count: number; value: number };
  approvedUnpaid: { count: number; value: number };
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summariseRegister(items: readonly Pick<RegisterItem, 'status' | 'estimated_cost' | 'agreed_cost'>[]): RegisterSummary {
  const byStatus = VARIATION_STATUSES.map((status) => {
    const rows = items.filter((i) => i.status === status);
    return { status, count: rows.length, value: round2(rows.reduce((s, i) => s + (itemValue(i) ?? 0), 0)) };
  });
  const pick = (statuses: readonly VariationStatus[]) => {
    const rows = items.filter((i) => statuses.includes(i.status));
    return { count: rows.length, value: round2(rows.reduce((s, i) => s + (itemValue(i) ?? 0), 0)) };
  };
  return {
    byStatus,
    notSubmitted: pick(NOT_SUBMITTED),
    approvedUnpaid: pick(['approved']),
    total: items.length,
  };
}

/** The path a variation walks. Rejected is the step off it. */
export const STAGES: readonly VariationStatus[] = ['raised', 'priced', 'submitted', 'approved', 'paid'];

export function stageIndex(status: VariationStatus): number {
  const i = STAGES.indexOf(status);
  return i === -1 ? 2 : i; // rejected sits where submitted was: it was with the client
}

/** The Perth calendar date of an instant, or a plain date as it is. Perth has no daylight saving; +8 is fixed. */
export function perthDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 8 * 3_600_000).toISOString().slice(0, 10) : iso.slice(0, 10);
}

/** Whole days from one date (or instant, read in Perth) to another. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${perthDate(to)}T00:00:00Z`) - Date.parse(`${perthDate(from)}T00:00:00Z`)) / 86_400_000));
}

/**
 * The date each stage was reached, from the ledger where it has one and the
 * item's own dates otherwise; null for a stage not reached, and null for a
 * stage nobody recorded passing through — a date is printed only where one
 * was recorded, never inferred. Ledger instants are read as Perth days.
 */
export function stageDates(item: Pick<RegisterItem, 'raised_on' | 'submitted_on' | 'decided_on' | 'paid_on' | 'status' | 'events'>): Record<VariationStatus, string | null> {
  const first = (status: VariationStatus) => { const e = item.events.find((x) => x.status === status); return e ? perthDate(e.at) : null; };
  const reached = stageIndex(item.status);
  return {
    raised: item.raised_on,
    priced: first('priced'),
    submitted: reached >= 2 ? first('submitted') ?? item.submitted_on : null,
    approved: item.status === 'approved' || item.status === 'paid' ? first('approved') ?? item.decided_on : null,
    rejected: item.status === 'rejected' ? first('rejected') ?? item.decided_on : null,
    paid: item.status === 'paid' ? first('paid') ?? item.paid_on : null,
  };
}

export type Waiting = { text: string; tone: 'act' | 'wait' | 'ok' | 'stop' };

/** What this variation is waiting on right now — the one line a PM reads. */
export function waitingOn(item: Pick<RegisterItem, 'status' | 'signed' | 'vr_ref' | 'estimated_cost' | 'agreed_cost' | 'submitted_on' | 'decided_on' | 'paid_on' | 'events' | 'raised_on' | 'mentions'>, today: string): Waiting {
  const dates = stageDates({ ...item, events: item.events });
  const since = (d: string | null) => (d ? ` · ${daysBetween(d, today)} day${daysBetween(d, today) === 1 ? '' : 's'}` : '');
  if (item.status === 'paid') return { text: `Paid${dates.paid ? ` ${fmtShort(dates.paid)}` : ''}`, tone: 'ok' };
  if (item.status === 'rejected') return { text: `Rejected${dates.rejected ? ` ${fmtShort(dates.rejected)}` : ''} — dispute it or let it go`, tone: 'stop' };
  if (item.mentions.length === 0) return { text: 'No diary day records it any more', tone: 'stop' };
  if (!item.signed) return { text: 'Sign the day that records it', tone: 'act' };
  if (item.status === 'approved') return { text: `Approved${dates.approved ? ` ${fmtShort(dates.approved)}` : ''} — invoice it${since(dates.approved)}`, tone: 'act' };
  if (item.status === 'submitted') {
    const days = dates.submitted ? daysBetween(dates.submitted, today) : 0;
    return { text: `With the client${dates.submitted ? ` since ${fmtShort(dates.submitted)}` : ''}${since(dates.submitted)}`, tone: days > 14 ? 'act' : 'wait' };
  }
  if (itemValue(item) == null) return { text: 'Put a value on it', tone: 'act' };
  if (item.status === 'raised') return { text: `Price it${since(item.raised_on)}`, tone: 'act' };
  return { text: `Send it to the client${item.vr_ref ? '' : ' — it has no client ref yet'}`, tone: 'act' };
}

function fmtShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

/** The lowest register number not yet used on this job. */
export function nextFreeNumber(items: readonly Pick<RegisterItem, 'seq'>[]): number {
  const used = new Set(items.map((i) => i.seq));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/** Action needed first, then waiting, then done; within a group by number. */
export function trackerOrder<T extends Parameters<typeof waitingOn>[0] & { seq: number }>(items: readonly T[], today: string): T[] {
  const rank: Record<Waiting['tone'], number> = { act: 0, wait: 1, stop: 2, ok: 3 };
  return items.slice().sort((a, b) => rank[waitingOn(a, today).tone] - rank[waitingOn(b, today).tone] || a.seq - b.seq);
}
