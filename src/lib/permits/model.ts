/**
 * Permits to work as facts: the kinds, the controls each kind asks about
 * before work starts and at close-out, numbering, and what "expired" means.
 * The database holds the same "every control answered" rule.
 */

export const PERMIT_KINDS = ['hot_work', 'excavation', 'confined_space', 'working_at_height', 'electrical', 'other'] as const;
export type PermitKind = (typeof PERMIT_KINDS)[number];
export const KIND_LABEL: Record<PermitKind, string> = {
  hot_work: 'Hot work', excavation: 'Excavation', confined_space: 'Confined space', working_at_height: 'Working at height', electrical: 'Electrical isolation', other: 'Other',
};

export type ControlResult = 'yes' | 'na';
export interface Control { key: string; label: string; result: ControlResult | null }

const COMMON = [
  'SWMS in use for this task and every worker signed on to it',
  'Workers hold the tickets and the induction the task needs',
  'Exclusion zone set and signed; others kept out',
  'Emergency plan known: first aid, rescue, how to raise the alarm',
  'Weather and conditions suitable for the work',
];
const BEFORE: Record<PermitKind, string[]> = {
  hot_work: [
    'Combustibles removed or shielded within 10 m; fuel and gas moved away',
    'Fire extinguisher and water at hand, checked and in date',
    'Fire watch named, stays 30 minutes after the last spark',
    'Gas cylinders upright, secured, flashback arrestors fitted',
    'Welding screens and PPE for the task',
    ...COMMON,
  ],
  excavation: [
    'Dial Before You Dig plans current; services located and potholed',
    'Batter or shoring designed for the ground; no vertical face over 1.5 m unsupported',
    'Spoil and plant kept back from the edge (at least the depth of the trench)',
    'Edge protection or barrier where a person could fall in',
    'Ladder or ramp for every 9 m of trench; a way out at all times',
    'Water: pump ready, no work in a flooded trench',
    ...COMMON,
  ],
  confined_space: [
    'Space identified and signed; entry controlled by this permit only',
    'Atmosphere tested before entry and monitored: oxygen 19.5–23.5 %, flammables under 5 % LEL, no toxics above exposure standard',
    'Ventilation in place and running',
    'Isolations done and locked: energy, liquids, gases, moving parts',
    'Standby person at the entry the whole time, with communications',
    'Rescue plan and equipment at the entry; rescue does not mean entering',
    'Entry log kept: who is in, who is out',
    ...COMMON,
  ],
  working_at_height: [
    'Edge protection, scaffold or EWP inspected and tagged',
    'Harness and lanyard inspected; anchor points rated and identified',
    'Rescue plan for a suspended worker, equipment on site',
    'Tools tethered; drop zone barricaded below',
    'Ladders only for short-duration access, footed and tied',
    ...COMMON,
  ],
  electrical: [
    'Isolation point identified, isolated, locked and tagged by each worker',
    'Tested for dead before touching; test instrument proved before and after',
    'Only licensed electrical workers on live or exposed conductors',
    'Earths applied where required',
    'Re-energising controlled: everyone clear, tags removed only by their owner',
    ...COMMON,
  ],
  other: [...COMMON],
};
const CLOSEOUT: Record<PermitKind, string[]> = {
  hot_work: ['Work complete and the area inspected', 'Fire watch complete — no smouldering, no heat', 'Equipment and cylinders removed and secured', 'Area left clean and safe; barriers and signs removed'],
  excavation: ['Work complete; trench backfilled, covered or fully protected', 'Plant and spoil clear of the edge', 'Barriers and signs left in place where the excavation remains open', 'Area left safe'],
  confined_space: ['Everyone out — entry log reconciled', 'Isolations removed only by their owners', 'Space closed, signed and secured', 'Equipment recovered'],
  working_at_height: ['Work complete; tools and materials down', 'Edge protection left in place where a fall remains possible', 'EWP or scaffold left safe or removed', 'Drop zone barriers removed'],
  electrical: ['Work complete; test complete', 'Locks and tags removed by their owners only', 'Re-energised under control; everyone clear', 'Isolation point restored and labelled'],
  other: ['Work complete', 'Area left clean and safe', 'Barriers and signs removed'],
};

function keyed(labels: string[]): Control[] {
  const seen = new Set<string>();
  return labels.map((label, i) => {
    let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `c_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i + 1}`;
    seen.add(key);
    return { key, label, result: null };
  });
}
export const controlsFor = (kind: PermitKind): Control[] => keyed(BEFORE[kind]);
export const closeoutFor = (kind: PermitKind): Control[] => keyed(CLOSEOUT[kind]);

export function readControls(json: unknown): Control[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { key: typeof r.key === 'string' && r.key ? r.key : `c_${i + 1}`, label: typeof r.label === 'string' ? r.label : '', result: r.result === 'yes' || r.result === 'na' ? r.result : null };
  });
}
export const allAnswered = (c: readonly Control[]) => c.length > 0 && c.every((x) => x.result != null);

export function permitRef(seq: number): string {
  return `PTW-${String(seq).padStart(3, '0')}`;
}

export type PermitStatus = 'open' | 'issued' | 'closed' | 'cancelled';
export const STATUS_LABEL: Record<PermitStatus, string> = { open: 'Not issued', issued: 'Issued', closed: 'Closed', cancelled: 'Cancelled' };

/** Issued, and its window has ended without a close-out. */
export function expired(p: { status: PermitStatus; valid_to: string }, nowIso: string): boolean {
  return p.status === 'issued' && p.valid_to < nowIso;
}
/** Issued and inside its window right now. */
export function live(p: { status: PermitStatus; valid_from: string; valid_to: string }, nowIso: string): boolean {
  return p.status === 'issued' && p.valid_from <= nowIso && nowIso <= p.valid_to;
}
