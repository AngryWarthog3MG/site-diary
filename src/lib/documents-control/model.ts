/**
 * Document control as facts: kinds, and who still has to read the current
 * version. Pure; the screen and any digest read the same answer.
 */
export const DOC_KINDS = ['policy', 'procedure', 'plan', 'form', 'other'] as const;
export type ControlledKind = (typeof DOC_KINDS)[number];
export const KIND_LABEL: Record<ControlledKind, string> = { policy: 'Policy', procedure: 'Procedure', plan: 'Plan', form: 'Form', other: 'Other' };

export function normalisePerson(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Of the crew, who has and has not acknowledged this version. */
export function coverage(crew: readonly string[], acknowledged: readonly string[]): { read: string[]; unread: string[] } {
  const done = new Set(acknowledged.map(normalisePerson));
  return {
    read: crew.filter((c) => done.has(normalisePerson(c))),
    unread: crew.filter((c) => !done.has(normalisePerson(c))),
  };
}

export function versionLabel(n: number): string {
  return `v${n}`;
}

/* ------------------------------------------------------------------------------------------------
   Assignments, the check, the overview (README R120). Pure.
   ------------------------------------------------------------------------------------------------ */

export type AssignmentStatus = 'pending' | 'signed' | 'superseded' | 'waived';

export interface AssignmentFacts {
  status: AssignmentStatus;
  due_on: string;
}

/** Overdue, due soon, due, or done — what a line shows and what a reminder keys on. */
export type DueState = 'overdue' | 'due_soon' | 'due' | 'signed' | 'waived' | 'superseded';

export const REMIND_BEFORE_DAYS = 3;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueState(a: AssignmentFacts, today: string): DueState {
  if (a.status !== 'pending') return a.status;
  if (a.due_on < today) return 'overdue';
  if (a.due_on <= addDays(today, REMIND_BEFORE_DAYS)) return 'due_soon';
  return 'due';
}

export const DUE_LABEL: Record<DueState, string> = {
  overdue: 'Overdue', due_soon: 'Due soon', due: 'To read and sign', signed: 'Signed', waived: 'Waived', superseded: 'Superseded',
};

/** The compliance figure: of the assignments still counting (signed, pending), how many are signed. Waived and superseded do not count either way. */
export function complianceSummary(assignments: readonly AssignmentFacts[], today: string): { due: number; signed: number; overdue: number; pending: number; percent: number | null } {
  const counting = assignments.filter((a) => a.status === 'signed' || a.status === 'pending');
  const signed = counting.filter((a) => a.status === 'signed').length;
  const pending = counting.length - signed;
  const overdue = counting.filter((a) => dueState(a, today) === 'overdue').length;
  return { due: counting.length, signed, overdue, pending, percent: counting.length === 0 ? null : Math.round((signed * 100) / counting.length) };
}

/**
 * Whether tonight's sweep reminds this assignment: pending, within three days of due or past it, and not reminded
 * in the last 48 hours. Mirrors the management system's rule.
 */
export function wantsReminder(a: AssignmentFacts & { last_reminded_at: string | null }, now: Date): boolean {
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const state = dueState(a, today);
  if (state !== 'overdue' && state !== 'due_soon') return false;
  if (!a.last_reminded_at) return true;
  return now.getTime() - Date.parse(a.last_reminded_at) >= 48 * 3600_000;
}

/** A question as the screen holds it: the right answer is never on the phone, so it is not here. */
export interface QuestionFacts { id: string; position: number; prompt: string; options: string[] }

/**
 * `POL-002 Code of Conduct v4.pdf` → code POL-002, title "Code of Conduct", kind policy, version note 4. Anything
 * the name does not say is null, never guessed — the import table lets the person fill it.
 */
export function parseImportFilename(name: string): { code: string | null; title: string; kind: ControlledKind | null; versionNote: string | null } {
  let stem = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  let code: string | null = null;
  const m = stem.match(/^([A-Z]{2,5}[- ]?\d{1,4}[A-Za-z]?)\b[\s\-–—:.]*(.*)$/);
  if (m) { code = m[1].replace(/\s/, '-').toUpperCase(); stem = m[2].trim(); }
  let versionNote: string | null = null;
  const v = stem.match(/^(.*?)[\s\-–—(]*\b(?:v|ver|version|rev|revision)\.?\s*([0-9]+(?:\.[0-9]+)?)\)?\s*$/i);
  if (v) { versionNote = v[2]; stem = v[1].trim(); }
  const prefix = code ? code.split(/[-\s]/)[0] : '';
  const byCode: Record<string, ControlledKind> = { POL: 'policy', PRO: 'procedure', PROC: 'procedure', SOP: 'procedure', WI: 'procedure', FRM: 'form', FORM: 'form', PLN: 'plan', PLAN: 'plan', MP: 'plan' };
  let kind: ControlledKind | null = byCode[prefix] ?? null;
  if (!kind) {
    if (/\bpolicy\b/i.test(stem)) kind = 'policy';
    else if (/\bprocedure\b|\bwork instruction\b|\bsop\b/i.test(stem)) kind = 'procedure';
    else if (/\bform\b|\bchecklist\b|\bregister\b/i.test(stem)) kind = 'form';
    else if (/\bplan\b/i.test(stem)) kind = 'plan';
  }
  return { code, title: stem.replace(/\s+/g, ' ').trim(), kind, versionNote };
}

export const AUDIENCE_LABEL: Record<string, string> = {
  admin: 'Admins', pm: 'Project managers', supervisor: 'Supervisors', leading_hand: 'Leading hands', labourer: 'Labourers',
};
export function audienceText(audience: readonly string[]): string {
  if (audience.length === 0) return 'Everyone on the company’s jobs';
  return audience.map((r) => AUDIENCE_LABEL[r] ?? r).join(', ');
}
