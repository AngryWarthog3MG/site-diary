/**
 * Safety statistics as arithmetic over the record. Nothing here is typed in:
 * every figure comes from rows the modules already keep, and every rate says
 * what it divides by. Pure, so the dashboard, the PDF and a tender answer
 * agree.
 */

export interface IncidentFacts { kind: string; occurred_at: string; treatment: string | null; status: string; notifiable: boolean }
export interface ActionFacts { due_on: string | null; done_at: string | null }

/** Medical treatment or hospital: the injuries a client's monthly report counts. First aid is counted separately. */
export function classify(i: IncidentFacts): 'mti' | 'fai' | 'near_miss' | 'hazard' | 'other' {
  if (i.kind === 'injury') return i.treatment === 'medical' || i.treatment === 'hospital' ? 'mti' : 'fai';
  if (i.kind === 'near_miss') return 'near_miss';
  if (i.kind === 'hazard') return 'hazard';
  return 'other';
}

export interface InjurySummary {
  mti: number; fai: number; nearMiss: number; hazards: number; other: number; notifiable: number;
  hoursWorked: number;
  /** Medical-treatment-or-worse injuries per million hours worked; null when hours are unknown or nil. */
  ratePerMillionHours: number | null;
}

export function injurySummary(incidents: readonly IncidentFacts[], hoursWorked: number): InjurySummary {
  const counts = { mti: 0, fai: 0, nearMiss: 0, hazards: 0, other: 0 };
  for (const i of incidents) {
    const c = classify(i);
    if (c === 'mti') counts.mti += 1; else if (c === 'fai') counts.fai += 1; else if (c === 'near_miss') counts.nearMiss += 1; else if (c === 'hazard') counts.hazards += 1; else counts.other += 1;
  }
  return {
    ...counts,
    notifiable: incidents.filter((i) => i.notifiable).length,
    hoursWorked: Math.round(hoursWorked * 100) / 100,
    ratePerMillionHours: hoursWorked > 0 ? Math.round((counts.mti / hoursWorked) * 1_000_000 * 10) / 10 : null,
  };
}

/** Whole days since the last injury of any treatment; null when there has never been one. */
export function daysSinceLastInjury(incidents: readonly IncidentFacts[], today: string): number | null {
  const last = incidents.filter((i) => i.kind === 'injury').map((i) => i.occurred_at.slice(0, 10)).sort().at(-1);
  if (!last) return null;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000));
}

/** Reports per calendar month for the last N months, oldest first; months with nothing still appear. */
export function monthBuckets(incidents: readonly IncidentFacts[], today: string, months = 6): Array<{ month: string; total: number; injuries: number; nearMisses: number; hazards: number }> {
  const out: Array<{ month: string; total: number; injuries: number; nearMisses: number; hazards: number }> = [];
  const [y, m] = today.split('-').map(Number);
  for (let k = months - 1; k >= 0; k -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    const key = d.toISOString().slice(0, 7);
    const inMonth = incidents.filter((i) => i.occurred_at.slice(0, 7) === key);
    out.push({ month: key, total: inMonth.length, injuries: inMonth.filter((i) => i.kind === 'injury').length, nearMisses: inMonth.filter((i) => i.kind === 'near_miss').length, hazards: inMonth.filter((i) => i.kind === 'hazard').length });
  }
  return out;
}

export function overdue(actions: readonly ActionFacts[], today: string): number {
  return actions.filter((a) => a.done_at == null && a.due_on != null && a.due_on < today).length;
}
export const openActions = (actions: readonly ActionFacts[]) => actions.filter((a) => a.done_at == null).length;
