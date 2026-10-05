// Relative on purpose: this module is unit-tested under plain Node, which has no '@/' alias.
import { normaliseName } from '../crew/tickets.ts';
import { cellFor, effectiveExpiry, requiredFor, type Competency } from '../training/model.ts';

/**
 * The company's staff list as one picture (README R123): each person with the jobs they are on, where they are
 * inducted, what they hold and what their role says they should. Pure — nothing here is typed for the page; every
 * line is read from the staff list, the crew lists, the tickets and the inductions, joined by the name on the sheets.
 */

export interface StaffRow { id: string; name: string; role: string | null; phone: string | null; employer: string | null; notes: string | null; active: boolean }
export interface JobRef { id: string; code: string; name: string }
export interface CrewRef { id: string; project_id: string; name: string; role: string | null; active: boolean }
export interface TicketRef { id: string; person_name: string; ticket_type: string; ticket_no: string | null; issued_on: string | null; expires_on: string | null; photo_path: string | null; active: boolean }
export interface InductionRef { project_id: string; person_name: string; inducted_on: string; notes: string | null }
export interface LoginRef { name: string; projectCode: string; role: string }

export type TicketState = 'current' | 'expiring' | 'expired';
export interface PersonTicket { id: string; key: string; label: string; ticketNo: string | null; issuedOn: string | null; expiresOn: string | null; photoPath: string | null; state: TicketState }
export interface PersonJob {
  projectId: string; code: string; name: string;
  /** Their row on that job's crew list, if there has ever been one. */
  crewId: string | null;
  /** On the crew list now — what the diary, the prestart and the gate offer. */
  onCrew: boolean;
  /** The role that job's list gives them, when it differs from the staff list's. */
  jobRole: string | null;
  inductedOn: string | null;
  inductionNotes: string | null;
}
export interface Person extends StaffRow {
  jobs: PersonJob[];
  tickets: PersonTicket[];
  /** The worst of what they hold: expired beats expiring beats current; none when nothing is recorded. */
  worst: TicketState | 'none';
  /** Competencies their role requires that they do not hold in date. */
  gaps: string[];
  /** Codes of the jobs they are on with no induction recorded. */
  notInducted: string[];
  /** Their app login, where an account carries the same name: "Supervisor on C001". */
  logins: string[];
}

export interface StaffInput {
  staff: readonly StaffRow[];
  jobs: readonly JobRef[];
  crew: readonly CrewRef[];
  tickets: readonly TicketRef[];
  inductions: readonly InductionRef[];
  competencies: readonly Competency[];
  requirements: ReadonlyArray<{ role: string; competency: string }>;
  logins: readonly LoginRef[];
}

const HORIZON_DAYS = 30;
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

export function ticketState(expiresOn: string | null, today: string): TicketState {
  if (expiresOn == null) return 'current';
  if (expiresOn < today) return 'expired';
  return expiresOn <= addDays(today, HORIZON_DAYS) ? 'expiring' : 'current';
}

export function buildStaff(input: StaffInput, today: string): Person[] {
  const comp = new Map(input.competencies.map((c) => [c.key, c]));
  return input.staff.map((s) => {
    const key = normaliseName(s.name);
    const mine = <T extends { person_name?: string; name?: string }>(rows: readonly T[]) => rows.filter((r) => normaliseName(r.person_name ?? r.name ?? '') === key);
    const crew = mine(input.crew);
    const inductions = mine(input.inductions);
    const held = mine(input.tickets).filter((t) => t.active);

    const jobs: PersonJob[] = input.jobs.map((j) => {
      const row = crew.find((c) => c.project_id === j.id) ?? null;
      const ind = inductions.find((i) => i.project_id === j.id) ?? null;
      const jobRole = row?.role?.trim() || null;
      return {
        projectId: j.id, code: j.code, name: j.name, crewId: row?.id ?? null, onCrew: Boolean(row?.active),
        jobRole: jobRole && jobRole.toLowerCase() !== (s.role ?? '').toLowerCase() ? jobRole : null,
        inductedOn: ind?.inducted_on ?? null, inductionNotes: ind?.notes ?? null,
      };
    });

    const tickets: PersonTicket[] = held.map((t) => {
      const c = comp.get(t.ticket_type);
      const expiresOn = effectiveExpiry(t, c?.validMonths);
      return { id: t.id, key: t.ticket_type, label: c?.label ?? (t.ticket_type === 'other' ? 'Other' : t.ticket_type), ticketNo: t.ticket_no, issuedOn: t.issued_on, expiresOn, photoPath: t.photo_path, state: ticketState(expiresOn, today) };
    }).sort((a, b) => a.label.localeCompare(b.label) || (b.expiresOn ?? '9999').localeCompare(a.expiresOn ?? '9999'));

    // What the role requires: the staff list's role and any a job's list gives them — all apply (the matrix's rule).
    const roles = [s.role, ...crew.filter((c) => c.active).map((c) => c.role)].map((r) => r?.trim() ?? '').filter(Boolean);
    const required = requiredFor(roles, input.requirements);
    const gaps = [...required].filter((k) => {
      const cell = cellFor(held, k, true, today, HORIZON_DAYS, comp.get(k)?.validMonths);
      return cell.state === 'missing' || cell.state === 'expired';
    }).map((k) => comp.get(k)?.label ?? k).sort((a, b) => a.localeCompare(b));

    const worst: Person['worst'] = tickets.some((t) => t.state === 'expired') ? 'expired' : tickets.some((t) => t.state === 'expiring') ? 'expiring' : tickets.length ? 'current' : 'none';
    return {
      ...s, jobs, tickets, worst, gaps,
      notInducted: jobs.filter((j) => j.onCrew && !j.inductedOn).map((j) => j.code),
      logins: input.logins.filter((l) => normaliseName(l.name) === key).map((l) => `${l.role} on ${l.projectCode}`),
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

export interface StaffSummary { people: number; onAJob: number; noJob: number; expired: number; expiring: number; notInducted: number; gaps: number; left: number }

/** The page's figures, over the people still with the company. */
export function summarise(people: readonly Person[]): StaffSummary {
  const here = people.filter((p) => p.active);
  const onAJob = here.filter((p) => p.jobs.some((j) => j.onCrew)).length;
  return {
    people: here.length, onAJob, noJob: here.length - onAJob,
    expired: here.reduce((n, p) => n + p.tickets.filter((t) => t.state === 'expired').length, 0),
    expiring: here.reduce((n, p) => n + p.tickets.filter((t) => t.state === 'expiring').length, 0),
    notInducted: here.reduce((n, p) => n + p.notInducted.length, 0),
    gaps: here.reduce((n, p) => n + p.gaps.length, 0),
    left: people.length - here.length,
  };
}

export type JobFilter = 'all' | 'none' | string;

/** The list as filtered on the page: by a few letters of the name or role, by job, with or without those who have left. */
export function filterStaff(people: readonly Person[], q: string, job: JobFilter, showLeft: boolean): Person[] {
  const needle = q.trim().toLowerCase();
  return people.filter((p) => {
    if (!p.active && !showLeft) return false;
    if (needle && !`${p.name} ${p.role ?? ''} ${p.employer ?? ''}`.toLowerCase().includes(needle)) return false;
    if (job === 'none') return !p.jobs.some((j) => j.onCrew);
    if (job !== 'all') return p.jobs.some((j) => j.projectId === job && j.onCrew);
    return true;
  });
}

/** What assigning this person to this job has to do to the crew list: add a row, show a hidden one, or nothing. */
export function assignStep(job: PersonJob): 'insert' | 'show' | 'none' {
  if (job.onCrew) return 'none';
  return job.crewId ? 'show' : 'insert';
}
