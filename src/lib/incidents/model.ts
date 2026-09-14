/**
 * Hazards, near misses and incidents as facts: the kinds, how they are
 * labelled and numbered, what is overdue, and the counts the register shows.
 */

export const INCIDENT_KINDS = ['hazard', 'near_miss', 'injury', 'plant_damage', 'property_damage', 'environmental', 'other'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export const KIND_LABEL: Record<IncidentKind, string> = {
  hazard: 'Hazard',
  near_miss: 'Near miss',
  injury: 'Injury or illness',
  plant_damage: 'Plant damage',
  property_damage: 'Property damage',
  environmental: 'Environmental',
  other: 'Other',
};

export const TREATMENTS = ['none', 'first_aid', 'medical', 'hospital'] as const;
export type Treatment = (typeof TREATMENTS)[number];
export const TREATMENT_LABEL: Record<Treatment, string> = {
  none: 'No treatment', first_aid: 'First aid on site', medical: 'Medical treatment', hospital: 'Hospital',
};

export const SEVERITIES = ['low', 'medium', 'high', 'extreme'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };

export type IncidentStatus = 'open' | 'investigating' | 'closed';
export const STATUS_LABEL: Record<IncidentStatus, string> = { open: 'Open', investigating: 'Investigating', closed: 'Closed' };

/** INC-007: how a report reads on screen and in an email. */
export function incidentRef(seq: number): string {
  return `INC-${String(seq).padStart(3, '0')}`;
}

export interface ActionFacts {
  due_on: string | null;
  done_at: string | null;
}

/** Overdue: not done, and its due date is before today. */
export function actionOverdue(a: ActionFacts, today: string): boolean {
  return a.done_at == null && a.due_on != null && a.due_on < today;
}

export interface IncidentFacts {
  kind: IncidentKind;
  status: IncidentStatus;
  notifiable: boolean;
  occurred_at: string;
}

export interface RegisterSummary {
  open: number;
  investigating: number;
  closed: number;
  notifiable: number;
  byKind: Array<{ kind: IncidentKind; count: number }>;
}

export function summarise(rows: readonly IncidentFacts[]): RegisterSummary {
  const byKind = new Map<IncidentKind, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  return {
    open: rows.filter((r) => r.status === 'open').length,
    investigating: rows.filter((r) => r.status === 'investigating').length,
    closed: rows.filter((r) => r.status === 'closed').length,
    notifiable: rows.filter((r) => r.notifiable).length,
    byKind: INCIDENT_KINDS.filter((k) => byKind.has(k)).map((k) => ({ kind: k, count: byKind.get(k) ?? 0 })),
  };
}

/** Which reports the office must hear about the moment they are made. */
export function urgent(r: { kind: IncidentKind; notifiable: boolean; actual_severity: Severity | null; potential_severity: Severity | null }): boolean {
  return r.notifiable || r.kind === 'injury' || r.actual_severity === 'high' || r.actual_severity === 'extreme' || r.potential_severity === 'extreme';
}
