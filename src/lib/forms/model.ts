/**
 * The forms engine as facts (README R180): what a form is made of, what an answer fails, how a form scores and
 * what stops it completing. Pure and dependency-free — the designer, the fill screen, the registers and the PDF
 * all read the same rules. The database holds the same rules in SQL (`app.form_template_problems`,
 * `app.form_answer_fails`, `app.form_score`, `app.form_completion_problems`) and the database wins.
 */

export const QUESTION_TYPES = ['yes_no', 'ok_issue_na', 'pass_fail', 'score', 'number', 'select', 'multi', 'text', 'date', 'time', 'photo', 'person', 'plant', 'signature'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  yes_no: 'Yes / No', ok_issue_na: 'OK / Issue / N/A', pass_fail: 'Pass / Fail', score: 'Score', number: 'Number', select: 'Pick one',
  multi: 'Pick any', text: 'Text', date: 'Date', time: 'Time', photo: 'Photograph', person: 'Person', plant: 'Machine', signature: 'Extra signature',
};
/** The types whose answer can fail — the ones the designer offers "raise an action" and "photo on a fail" for. */
export const FAILABLE_TYPES: readonly QuestionType[] = ['yes_no', 'ok_issue_na', 'pass_fail', 'score', 'number', 'select', 'multi'];

export const FORM_CATEGORIES = ['safety', 'plant', 'vehicle', 'people', 'environment', 'quality', 'other'] as const;
export type FormCategory = (typeof FORM_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<FormCategory, string> = {
  safety: 'Safety', plant: 'Plant', vehicle: 'Vehicles', people: 'People', environment: 'Environment', quality: 'Quality', other: 'Other',
};

export const TEMPLATE_STATUSES = ['draft', 'issued', 'superseded', 'retired'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = { draft: 'Draft', issued: 'Issued', superseded: 'Superseded', retired: 'Retired' };

export const PROFILES = ['public', 'scheduled'] as const;
export type FormProfile = (typeof PROFILES)[number];
export const PROFILE_LABEL: Record<FormProfile, string> = { public: 'Any time', scheduled: 'Scheduled' };

export const SUBJECTS = ['none', 'plant', 'person'] as const;
export type FormSubject = (typeof SUBJECTS)[number];
export const SUBJECT_LABEL: Record<FormSubject, string> = { none: 'Nothing in particular', plant: 'A machine', person: 'A person' };

export const SIGNATURE_RULES = ['required', 'optional', 'none'] as const;
export type SignatureRule = (typeof SIGNATURE_RULES)[number];

export const AUDIENCE_ROLES = ['supervisor', 'leading_hand', 'labourer', 'pm', 'admin'] as const;

export type SubmissionStatus = 'open' | 'completed' | 'voided';
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = { open: 'Open', completed: 'Completed', voided: 'Voided' };
export type Outcome = 'pass' | 'fail';

export type NcStatus = 'open' | 'resolved' | 'removed';
export const NC_STATUS_LABEL: Record<NcStatus, string> = { open: 'Open', resolved: 'Resolved', removed: 'Removed' };

export interface HeaderField { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] }
export interface Question {
  key: string;
  label: string;
  type: QuestionType;
  required?: boolean;
  help?: string;
  /** Score: the top of the scale (default 5) and the weight (default 1); below `fail` fails. */
  max?: number;
  weight?: number;
  /** yes_no: which answer fails ('no' by default). score: the value under which it fails. */
  fail?: string | number;
  /** number: outside the range fails. */
  min?: number;
  /** select / multi: the choices, and the ones that fail. */
  options?: string[];
  fail_options?: string[];
  unit?: string;
  raise_action?: boolean;
  photo_required?: boolean;
}
export interface Section { title: string; questions: Question[] }
export interface FormSpec { header: HeaderField[]; sections: Section[] }

export interface Answer { value?: unknown; note?: string | null; photo_paths?: string[] }
export type Answers = Record<string, Answer>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

/** Stored JSON → a spec, tolerant: a broken piece reads as empty rather than throwing on the phone. */
export function readSpec(json: unknown): FormSpec {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const header: HeaderField[] = (Array.isArray(j.header) ? j.header : []).map((raw) => {
    const h = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const type: HeaderField['type'] = h.type === 'number' || h.type === 'date' || h.type === 'select' ? h.type : 'text';
    const out: HeaderField = { key: str(h.key), label: str(h.label), type };
    if (strs(h.options)) out.options = strs(h.options);
    return out;
  }).filter((h) => h.key);
  const sections: Section[] = (Array.isArray(j.sections) ? j.sections : []).map((raw) => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const questions: Question[] = (Array.isArray(s.questions) ? s.questions : []).map((rq) => {
      const q = (rq && typeof rq === 'object' ? rq : {}) as Record<string, unknown>;
      const type = (QUESTION_TYPES as readonly string[]).includes(str(q.type)) ? (q.type as QuestionType) : 'text';
      const out: Question = { key: str(q.key), label: str(q.label), type };
      if (q.required === true) out.required = true;
      if (str(q.help)) out.help = str(q.help);
      if (num(q.max) != null) out.max = num(q.max);
      if (num(q.weight) != null) out.weight = num(q.weight);
      if (typeof q.fail === 'string' || typeof q.fail === 'number') out.fail = q.fail;
      if (num(q.min) != null) out.min = num(q.min);
      if (strs(q.options)) out.options = strs(q.options);
      if (strs(q.fail_options)) out.fail_options = strs(q.fail_options);
      if (str(q.unit)) out.unit = str(q.unit);
      if (q.raise_action === true) out.raise_action = true;
      if (q.photo_required === true) out.photo_required = true;
      return out;
    });
    return { title: str(s.title), questions };
  });
  return { header, sections };
}

export function readAnswers(json: unknown): Answers {
  const j = (json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<string, unknown>;
  const out: Answers = {};
  for (const [k, raw] of Object.entries(j)) {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    out[k] = { value: a.value, note: typeof a.note === 'string' && a.note.trim() ? a.note : null, photo_paths: strs(a.photo_paths) ?? [] };
  }
  return out;
}

export const questions = (spec: Pick<FormSpec, 'sections'>): Question[] => spec.sections.flatMap((s) => s.questions);

const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** What is wrong with a form, in words; empty = it may issue. The SQL twin is `app.form_template_problems`. */
export function templateProblems(spec: FormSpec): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  let n = 0;
  spec.sections.forEach((s, si) => {
    if (!s.title.trim()) problems.push(`Section ${si + 1} has no title.`);
    if (s.questions.length === 0) problems.push(`Section ${si + 1} has no questions.`);
    for (const q of s.questions) {
      n += 1;
      if (!KEY_RE.test(q.key)) { problems.push(`Question ${n} has no key.`); continue; }
      if (keys.has(q.key)) problems.push(`Question key "${q.key}" is used twice.`);
      keys.add(q.key);
      if (!q.label.trim()) problems.push(`Question "${q.key}" has no wording.`);
      if (!(QUESTION_TYPES as readonly string[]).includes(q.type)) problems.push(`Question "${q.key}" has an unknown type.`);
      if (q.type === 'score' && ((q.max ?? 5) < 1 || (q.max ?? 5) > 100)) problems.push(`Question "${q.key}": a score runs to between 1 and 100.`);
      if (q.type === 'score' && (q.weight ?? 1) <= 0) problems.push(`Question "${q.key}": the weight is above zero.`);
      if ((q.type === 'select' || q.type === 'multi') && (!q.options || q.options.length === 0)) problems.push(`Question "${q.key}" has no options.`);
      if (q.type === 'number' && q.min != null && q.max != null && q.min > q.max) problems.push(`Question "${q.key}": the minimum is above the maximum.`);
      if (q.type === 'yes_no' && q.fail != null && q.fail !== 'yes' && q.fail !== 'no') problems.push(`Question "${q.key}": the failing answer is yes or no.`);
    }
  });
  if (n === 0) problems.push('The form has no questions.');
  return problems;
}

/** A → B … Y → Z; past Z an A is appended. The SQL twin is `app.next_revision`. */
export function nextRevision(rev: string): string {
  return /^[A-Y]$/.test(rev) ? String.fromCharCode(rev.charCodeAt(0) + 1) : `${rev}A`;
}

const valueText = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));
const NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;

/** Is this question answered at all? A photograph question is answered by a photograph. */
export function answered(q: Question, a: Answer | undefined): boolean {
  if (!a) return false;
  if (q.type === 'photo') return (a.photo_paths ?? []).length > 0;
  const v = a.value;
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Does this answer FAIL the question? Unanswered is never a fail. The SQL twin is `app.form_answer_fails`. */
export function answerFails(q: Question, a: Answer | undefined): boolean {
  if (!a || a.value == null) return false;
  const v = a.value;
  const s = valueText(v) ?? '';
  switch (q.type) {
    case 'yes_no': return s === String(q.fail ?? 'no');
    case 'ok_issue_na': return s === 'issue';
    case 'pass_fail': return s === 'fail';
    case 'score': return q.fail != null && NUM_RE.test(s) && Number(s) < Number(q.fail);
    case 'number': {
      if (!NUM_RE.test(s)) return false;
      const n = Number(s);
      return (q.min != null && n < q.min) || (q.max != null && n > q.max);
    }
    case 'select': return (q.fail_options ?? []).includes(s);
    case 'multi': return Array.isArray(v) && v.some((x) => (q.fail_options ?? []).includes(String(x)));
    default: return false;
  }
}

/** The score as a percentage over the ANSWERED score questions, weighted; null when there are none. Twin of `app.form_score`. */
export function score(spec: FormSpec, answers: Answers): number | null {
  let got = 0; let of = 0;
  for (const q of questions(spec)) {
    if (q.type !== 'score') continue;
    const a = answers[q.key];
    if (!answered(q, a)) continue;
    const s = valueText(a?.value) ?? '';
    if (!NUM_RE.test(s)) continue;
    const w = q.weight ?? 1; const mx = q.max ?? 5;
    if (mx <= 0) continue;
    got += w * Math.min(Math.max(Number(s), 0), mx) / mx; of += w;
  }
  if (of === 0) return null;
  return Math.round((100 * got / of) * 10) / 10;
}

export const failing = (spec: FormSpec, answers: Answers): Question[] => questions(spec).filter((q) => answerFails(q, answers[q.key]));

export interface CompletionContext { subject: FormSubject; subjectPlantId: string | null; subjectPerson: string | null; signatureRule: SignatureRule; hasSignature: boolean }

/** What stops the form completing, in words; empty = it may. Twin of `app.form_completion_problems` plus the subject and signature rules. */
export function completionProblems(spec: FormSpec, answers: Answers, ctx: CompletionContext): string[] {
  const problems: string[] = [];
  for (const q of questions(spec)) {
    const a = answers[q.key];
    if (q.required && !answered(q, a)) problems.push(`"${q.label}" is not answered.`);
    if (q.photo_required && answerFails(q, a) && (a?.photo_paths ?? []).length === 0) problems.push(`"${q.label}" failed and needs a photograph.`);
  }
  if (ctx.subject === 'plant' && !ctx.subjectPlantId) problems.push('Which machine the form is about.');
  if (ctx.subject === 'person' && !ctx.subjectPerson?.trim()) problems.push('Who the form is about.');
  if (ctx.signatureRule === 'required' && !ctx.hasSignature) problems.push('The signature.');
  return problems;
}

/** Pass or fail: any failing answer fails it, and so does a score under the pass mark. */
export function outcome(spec: FormSpec, answers: Answers, passMark: number | null): Outcome {
  if (failing(spec, answers).length > 0) return 'fail';
  const s = score(spec, answers);
  if (passMark != null && s != null && s < passMark) return 'fail';
  return 'pass';
}

/** A key from a label, the way the inspection templates do it, unique within the form. */
export function keyFor(label: string, taken: Set<string>, n: number): string {
  let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || `q_${n}`;
  while (taken.has(key)) key = `${key}_${n}`;
  taken.add(key);
  return key;
}

/**
 * A paper checklist typed in one line per question: a line starting `#` opens a section, every other line is an
 * OK / Issue / N/A question. The office then sets types and rules in the designer.
 */
export function specFromLines(text: string): FormSpec {
  const taken = new Set<string>();
  const sections: Section[] = [];
  let n = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { sections.push({ title: line.replace(/^#+\s*/, '') || `Section ${sections.length + 1}`, questions: [] }); continue; }
    if (sections.length === 0) sections.push({ title: 'Checks', questions: [] });
    n += 1;
    sections[sections.length - 1].questions.push({ key: keyFor(line, taken, n), label: line, type: 'ok_issue_na' });
  }
  return { header: [], sections };
}

export interface SubmissionFacts { status: SubmissionStatus; outcome: Outcome | null; completed_at: string | null }
export interface NcFacts { status: NcStatus; raised_as_action: boolean; due_on: string | null; done_at: string | null }

/** The register's tiles. */
export function summariseForms(subs: readonly SubmissionFacts[], ncs: readonly NcFacts[], today: string): { completed: number; open: number; failed: number; ncOpen: number; ncOverdue: number } {
  const completed = subs.filter((s) => s.status === 'completed');
  return {
    completed: completed.length,
    open: subs.filter((s) => s.status === 'open').length,
    failed: completed.filter((s) => s.outcome === 'fail').length,
    ncOpen: ncs.filter((n) => n.status === 'open').length,
    ncOverdue: ncs.filter((n) => n.status === 'open' && n.raised_as_action && n.due_on != null && n.due_on < today).length,
  };
}

/** The answer as it prints: the word, the number with its unit, the choices, or a dash. */
export function answerText(q: Question, a: Answer | undefined): string {
  if (!answered(q, a)) return '—';
  const v = a?.value;
  if (q.type === 'photo') return `${(a?.photo_paths ?? []).length} photo${(a?.photo_paths ?? []).length === 1 ? '' : 's'}`;
  if (q.type === 'yes_no') return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : String(v);
  if (q.type === 'ok_issue_na') return v === 'ok' ? 'OK' : v === 'issue' ? 'Issue' : v === 'na' ? 'N/A' : String(v);
  if (q.type === 'pass_fail') return v === 'pass' ? 'Pass' : v === 'fail' ? 'Fail' : String(v);
  if (q.type === 'score') return `${String(v)} / ${q.max ?? 5}`;
  if (q.type === 'number') return `${String(v)}${q.unit ? ` ${q.unit}` : ''}`;
  if (Array.isArray(v)) return v.map(String).join(', ');
  return String(v);
}
