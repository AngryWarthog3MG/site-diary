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
  /** The diary days that mention it, earliest first. */
  mentions: Array<{ date: string; entry_no: string }>;
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
