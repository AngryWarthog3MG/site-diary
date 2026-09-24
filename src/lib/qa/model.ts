/**
 * The QA engine (README R96): one template shape for ITPs, ITR checklists,
 * ITR registers and the site-pack forms, and the arithmetic of a record —
 * what is a gap, when a record is complete, when a hold point is released.
 * Pure, relative imports only — node-tested. The database holds the same
 * rules (`app.qa_template_problems`, the record trigger); the database wins.
 */

export const QA_KINDS = ['itp', 'itr_checklist', 'itr_register', 'site_form'] as const;
export type QaKind = (typeof QA_KINDS)[number];
export const KIND_LABEL: Record<QaKind, string> = { itp: 'Inspection and test plan', itr_checklist: 'Inspection and test record', itr_register: 'Register', site_form: 'Site form' };

export const VALUE_TYPES = ['none', 'text', 'number', 'ref', 'photo'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export const ITEM_STATES = ['ok', 'na', 'gap'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export interface HeaderField { key: string; label: string; type: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'multiline'; options?: string[]; default?: string; unit?: string; note?: string }
export interface TemplateItem { id: string; text: string; reference?: string; responsible?: string; value_type?: ValueType; value_label?: string; hold_point?: boolean; notice?: string }
export interface TemplateSection { title: string; items: TemplateItem[] }
export interface RegisterColumn { key: string; label: string; type: 'text' | 'number' | 'date' | 'datetime' | 'select'; unit?: string; options?: string[] }
export interface Signoff { party: string; required: boolean; kind: 'internal' | 'external'; is_release?: boolean }
export interface ItpActivity { no: string; group?: string; activity: string; governing: string[]; criteria: string[]; record: string[]; inspection: Record<string, string> }

export interface QaTemplate {
  code: string;
  kind: QaKind;
  title: string;
  revision: string;
  governing_itp?: string;
  modules?: string[];
  header_fields?: HeaderField[];
  sections?: TemplateSection[];
  columns?: RegisterColumn[];
  sub_register?: { heading?: string; columns: RegisterColumn[]; rows_printed?: number };
  signoffs?: Signoff[];
  hold_point?: boolean;
  parties?: string[];
  activities?: ItpActivity[];
}

export interface ItemResult { item_id: string; state: ItemState; value?: string | number | null; photo_paths?: string[] }
export interface RecordSignoff { party: string; signer_name: string; signature_path: string; signed_at: string; signed_by_user_id?: string | null }
export interface QaRecordLike {
  items: ItemResult[];
  rows?: Array<Record<string, unknown>>;
  signoffs: RecordSignoff[];
  voided_at?: string | null;
  submitted_at?: string | null;
}

const INSPECTION = /^(H|W|R)(,\s*(H|W|R))*$/;

/** What is wrong with a template before it is saved — the office's own check; the DB has the same rules. */
export function templateProblems(t: Partial<QaTemplate>): string[] {
  const out: string[] = [];
  if (!t.code?.trim()) out.push('a code');
  if (!t.kind || !QA_KINDS.includes(t.kind)) out.push('a kind (itp, itr_checklist, itr_register or site_form)');
  if (!t.title?.trim()) out.push('a title');
  if (!t.revision?.trim()) out.push('a revision');
  const signoffs = t.signoffs ?? [];
  signoffs.forEach((s, i) => { if (!s.party?.trim()) out.push(`sign-off ${i + 1} needs a party`); });
  if (signoffs.some((s) => s.is_release) && !t.hold_point) out.push('a release sign-off only on a hold point form');
  const ids = new Set<string>();
  if (t.kind === 'itp') {
    if (!t.parties?.length) out.push('the inspecting parties');
    if (!t.activities?.length) out.push('at least one activity');
    (t.activities ?? []).forEach((a) => {
      if (!a.no?.trim() || !a.activity?.trim()) out.push('every activity numbered and named');
      if (ids.has(a.no)) out.push(`activity ${a.no} twice`); ids.add(a.no);
      for (const [party, mark] of Object.entries(a.inspection ?? {})) {
        if (!(t.parties ?? []).includes(party)) out.push(`activity ${a.no} inspects for an unknown party (${party})`);
        if (mark && !INSPECTION.test(mark)) out.push(`activity ${a.no}: inspection type ${mark} is not H, W or R`);
      }
    });
  } else if (t.kind === 'itr_register') {
    if (!t.columns?.length) out.push('at least one column');
    const keys = new Set<string>();
    (t.columns ?? []).forEach((c) => { if (!c.key?.trim() || !c.label?.trim()) out.push('every column keyed and labelled'); if (keys.has(c.key)) out.push(`column ${c.key} twice`); keys.add(c.key); });
  } else if (t.kind === 'itr_checklist' || t.kind === 'site_form') {
    const items = (t.sections ?? []).flatMap((s) => s.items ?? []);
    if (items.length === 0) out.push('at least one item');
    items.forEach((it) => {
      if (!it.id?.trim() || !it.text?.trim()) out.push('every item numbered and worded');
      if (ids.has(it.id)) out.push(`item ${it.id} twice`); ids.add(it.id);
      if (it.value_type && !VALUE_TYPES.includes(it.value_type)) out.push(`item ${it.id}: value type ${it.value_type}`);
    });
  }
  const hk = new Set<string>();
  (t.header_fields ?? []).forEach((h) => { if (!h.key?.trim() || !h.label?.trim()) out.push('every header field keyed and labelled'); if (hk.has(h.key)) out.push(`header field ${h.key} twice`); hk.add(h.key); });
  return [...new Set(out)];
}

/** Every item id a checklist or site form carries, in order. */
export function itemIds(t: Pick<QaTemplate, 'sections'>): string[] {
  return (t.sections ?? []).flatMap((s) => s.items.map((i) => i.id));
}

/** At submit a blank item is a gap, never a blocker: fill what the supervisor left, in template order. */
export function blanksAsGaps(t: Pick<QaTemplate, 'sections'>, results: readonly ItemResult[]): ItemResult[] {
  const byId = new Map(results.map((r) => [r.item_id, r]));
  return itemIds(t).map((id) => byId.get(id) ?? { item_id: id, state: 'gap' });
}

export function gapCount(results: readonly Pick<ItemResult, 'state'>[]): number {
  return results.filter((r) => r.state === 'gap').length;
}

const signed = (r: QaRecordLike, party: string) => r.signoffs.some((s) => s.party === party && s.signer_name?.trim() && s.signature_path && s.signed_at);

/** Every required party has signed. */
export function signoffsComplete(t: Pick<QaTemplate, 'signoffs'>, r: QaRecordLike): boolean {
  return (t.signoffs ?? []).filter((s) => s.required).every((s) => signed(r, s.party));
}

/** Every party that releases the hold point has signed (false when the form has no release party). */
export function released(t: Pick<QaTemplate, 'signoffs' | 'hold_point'>, r: QaRecordLike): boolean {
  const rel = (t.signoffs ?? []).filter((s) => s.is_release);
  return rel.length > 0 && rel.every((s) => signed(r, s.party));
}

export type RecordState = 'voided' | 'released' | 'complete' | 'awaiting_release' | 'gaps_open' | 'in_progress';
export const STATE_LABEL: Record<RecordState, string> = {
  voided: 'Voided', released: 'Released', complete: 'Complete', awaiting_release: 'Awaiting release', gaps_open: 'Gaps open', in_progress: 'In progress',
};

/**
 * One word for where a record stands. Voided beats everything; a hold point
 * form is "released" only once every release party has signed; a signed
 * record with gaps still says so — a gap is an answer, and the office reads it.
 */
export function recordState(t: Pick<QaTemplate, 'signoffs' | 'hold_point'>, r: QaRecordLike): RecordState {
  if (r.voided_at) return 'voided';
  const gaps = gapCount(r.items);
  const complete = signoffsComplete(t, r);
  if (t.hold_point) {
    if (released(t, r) && complete && gaps === 0) return 'released';
    // A sign-off on it, or a submit, means it is waiting on someone — the office's hold point queue.
    const started = complete || !!r.submitted_at || r.signoffs.length > 0;
    if (gaps > 0 && started) return 'gaps_open';
    return started ? 'awaiting_release' : 'in_progress';
  }
  if (complete) return gaps > 0 ? 'gaps_open' : 'complete';
  return gaps > 0 && r.submitted_at ? 'gaps_open' : 'in_progress';
}

/** The next revision letter: A → B, Z → AA. */
export function nextRevision(rev: string): string {
  const s = rev.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? String(n + 1) : `${s}.1`; }
  const chars = s.split('');
  let i = chars.length - 1;
  while (i >= 0) { if (chars[i] === 'Z') { chars[i] = 'A'; i -= 1; } else { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); return chars.join(''); } }
  return 'A' + chars.join('');
}

/** What a template holds, for the transcription table: items, columns, activities, sign-offs. */
export function templateCounts(t: QaTemplate): { items: number; columns: number; activities: number; signoffs: number; header_fields: number; hold_points: number } {
  const items = (t.sections ?? []).flatMap((s) => s.items);
  return {
    items: items.length,
    columns: (t.columns ?? []).length + (t.sub_register?.columns.length ?? 0),
    activities: (t.activities ?? []).length,
    signoffs: (t.signoffs ?? []).length,
    header_fields: (t.header_fields ?? []).length,
    hold_points: items.filter((i) => i.hold_point).length + (t.activities ?? []).filter((a) => Object.values(a.inspection).some((m) => /H/.test(m))).length,
  };
}
