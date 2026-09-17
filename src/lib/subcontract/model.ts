/**
 * Working under a head contractor (README R74). Pure, relative imports only — node-tested.
 * The database holds the same rules and wins where they differ.
 */

/** What the app calls the other party: their name when the job has one, else "the head contractor". */
export function headContractorName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n || 'the head contractor';
}

// ---------------------------------------------------------------- incidents told up
export const NOTICE_METHODS = ['phone', 'in_person', 'email', 'their_system', 'other'] as const;
export type NoticeMethod = (typeof NOTICE_METHODS)[number];
export const NOTICE_METHOD_LABEL: Record<NoticeMethod, string> = {
  phone: 'By phone', in_person: 'In person', email: 'By email', their_system: 'In their incident system', other: 'Other',
};

export interface IncidentNotice { id: string; notified_at: string; method: NoticeMethod; told_by_name: string; recipient_name: string | null; reference: string | null; detail: string | null }

export interface NoticeState {
  toldAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  /** Minutes from the incident to telling them; null until told. */
  minutesToTell: number | null;
}

/** Whether, and how promptly, the head contractor was told. The clock runs from when it happened; no hours = no deadline. */
export function noticeState(occurredAt: string, notices: readonly IncidentNotice[], hours: number | null, now: string): NoticeState {
  const first = [...notices].sort((a, b) => a.notified_at.localeCompare(b.notified_at))[0] ?? null;
  const dueAt = hours == null ? null : new Date(Date.parse(occurredAt) + hours * 3_600_000).toISOString();
  return {
    toldAt: first?.notified_at ?? null,
    dueAt,
    overdue: !first && dueAt != null && now > dueAt,
    minutesToTell: first ? Math.max(0, Math.round((Date.parse(first.notified_at) - Date.parse(occurredAt)) / 60_000)) : null,
  };
}

// ---------------------------------------------------------------- the head contractor's plans
export const HC_DOC_KINDS = ['whs_management_plan', 'environmental_management_plan', 'emergency_plan', 'traffic_management_plan', 'site_rules', 'induction', 'other'] as const;
export type HcDocKind = (typeof HC_DOC_KINDS)[number];
export const HC_DOC_LABEL: Record<HcDocKind, string> = {
  whs_management_plan: 'WHS management plan',
  environmental_management_plan: 'Environmental management plan (CEMP)',
  emergency_plan: 'Emergency plan',
  traffic_management_plan: 'Traffic management plan',
  site_rules: 'Site rules',
  induction: 'Site induction material',
  other: 'Other plan or procedure',
};
/** Reports made before head contractor notices existed are not asked for (README R78): the record began here. */
export const HC_NOTICE_FROM = '2026-09-17T00:00:00+08:00';

/** The ones What's due asks for on a subcontract job. */
export const HC_DOC_EXPECTED: readonly HcDocKind[] = ['whs_management_plan', 'emergency_plan'];

export interface HcDoc { id: string; kind: HcDocKind; title: string; revision: string | null; received_on: string; file_path: string | null; superseded_by: string | null; notes: string | null; created_at?: string }

/** The copy in force for each kind: not superseded, latest received. Older copies are kept, not shown as current. */
export function currentDocs<T extends HcDoc>(docs: readonly T[]): Map<HcDocKind, T> {
  const out = new Map<HcDocKind, T>();
  for (const d of docs) {
    if (d.superseded_by) continue;
    const have = out.get(d.kind);
    if (!have || d.received_on > have.received_on || (d.received_on === have.received_on && (d.created_at ?? '') > (have.created_at ?? ''))) out.set(d.kind, d);
  }
  return out;
}

// ---------------------------------------------------------------- SWMS to the head contractor
export type SwmsReviewKind = 'submitted' | 'accepted' | 'returned';
export interface SwmsReview { id: string; kind: SwmsReviewKind; happened_on: string; person_name: string | null; reference: string | null; comments: string | null; created_at: string; /** Still on this phone, not yet sent: after every saved step of the same day. */ queued?: boolean }
export type SwmsReviewStatus = 'not_submitted' | 'with_them' | 'accepted' | 'returned';
export const SWMS_REVIEW_LABEL: Record<SwmsReviewStatus, string> = {
  not_submitted: 'Not yet submitted', with_them: 'Submitted, awaiting their review', accepted: 'Accepted', returned: 'Returned for changes',
};

/** Where a SWMS stands with the head contractor: the latest step decides, in the order it was recorded. */
export function swmsReviewStatus(reviews: readonly SwmsReview[]): { status: SwmsReviewStatus; latest: SwmsReview | null } {
  const sorted = [...reviews].sort((a, b) => a.happened_on.localeCompare(b.happened_on) || Number(Boolean(a.queued)) - Number(Boolean(b.queued)) || a.created_at.localeCompare(b.created_at));
  const latest = sorted[sorted.length - 1] ?? null;
  if (!latest) return { status: 'not_submitted', latest };
  return { status: latest.kind === 'submitted' ? 'with_them' : latest.kind, latest };
}
