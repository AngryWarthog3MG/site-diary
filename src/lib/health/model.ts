import { dueStatus } from '../obligations/model.ts';

/**
 * Health monitoring (WHS (General) Regulations 2022 (WA) Part 7.1 Div 6, Part 7.2).
 * Pure: no client, relative imports only, so `node --test` runs it.
 *
 * What falls due is read person by person off their LATEST record in a
 * programme — a newer report replaces the next-due date the older one set —
 * and is reported per programme as counts only. No name leaves this module:
 * the What's due list is read by people who are not record keepers' equals,
 * and a count is all a schedule needs.
 */

export interface MonitoringFacts {
  program_id: string;
  person_name: string;
  monitored_on: string;
  next_due_on: string | null;
}

export interface ProgrammeDue {
  programId: string;
  overdue: number;
  dueSoon: number;
  /** The earliest next-due date among the people who are overdue or due soon. */
  earliestDue: string | null;
}

const personKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Each person's latest record in each programme. */
export function latestPerPerson<T extends MonitoringFacts>(records: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const r of records) {
    const k = `${r.program_id}|${personKey(r.person_name)}`;
    const prev = latest.get(k);
    if (!prev || r.monitored_on > prev.monitored_on) latest.set(k, r);
  }
  return [...latest.values()];
}

/** Per programme, how many people are overdue or due soon — counts, never names. Programmes with neither are left out. */
export function programmesDue(records: readonly MonitoringFacts[], today: string): ProgrammeDue[] {
  const out = new Map<string, ProgrammeDue>();
  for (const r of latestPerPerson(records)) {
    const status = dueStatus(r.next_due_on, today);
    if (status !== 'overdue' && status !== 'due_soon') continue;
    const row = out.get(r.program_id) ?? { programId: r.program_id, overdue: 0, dueSoon: 0, earliestDue: null };
    if (status === 'overdue') row.overdue += 1; else row.dueSoon += 1;
    if (r.next_due_on && (row.earliestDue == null || r.next_due_on < row.earliestDue)) row.earliestDue = r.next_due_on;
    out.set(r.program_id, row);
  }
  return [...out.values()];
}

/** The retention the database stamps: 30 years from the monitoring, 40 for asbestos (reg. 378). */
export function retainUntil(monitoredOn: string, asbestos: boolean): string {
  const y = Number(monitoredOn.slice(0, 4)) + (asbestos ? 40 : 30);
  const md = monitoredOn.slice(5);
  // 29 February becomes 28 February in a year that has none, as Postgres does.
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
}

/** The last day lead risk work may be notified: seven days after it is determined (reg. 394). */
export function leadNotifyBy(determinedOn: string): string {
  const d = new Date(`${determinedOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}
