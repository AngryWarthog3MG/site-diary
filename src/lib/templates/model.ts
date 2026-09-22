/**
 * The company's template library (README R91): the vocabulary of kinds,
 * tiers and priorities, and the small arithmetic the editor shows. Pure,
 * relative imports only — node-tested.
 */

export const TEMPLATE_KINDS = ['start_gate', 'hold_point', 'submittal', 'swms', 'consumable', 'risk', 'document', 'folder'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const KIND_LABEL: Record<TemplateKind, string> = {
  start_gate: 'Mobilisation item',
  hold_point: 'Hold point',
  submittal: 'Submittal',
  swms: 'SWMS to have',
  consumable: 'Consumable',
  risk: 'Risk',
  document: 'Expected document',
  folder: 'Folder',
};

export const KIND_HINT: Record<TemplateKind, string> = {
  start_gate: 'Something to have in place before the job starts — who owns it, and how soon',
  hold_point: 'Work that stops until someone releases it',
  submittal: 'Something the head contractor must receive from us',
  swms: 'A method statement the job must have in use before that work starts',
  consumable: 'Kept on site at a par level; the Friday check reorders below it',
  risk: 'A risk this kind of work carries, for the job’s register',
  document: 'A document expected in one of the twelve folders; its absence is a gap on the dashboard',
  folder: 'One of the twelve standard folders',
};

export const TIERS = ['light', 'full'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = { light: 'Light — every job, even a small purchase order', full: 'Full — the whole module' };

export const PRIORITIES = ['A', 'B', 'C'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const OWNERS = ['office', 'site'] as const;
export type Owner = (typeof OWNERS)[number];

/** The twelve folders the brief names; office-only ones marked. */
export const FOLDERS: ReadonlyArray<{ no: number; name: string; office: boolean }> = [
  { no: 1, name: 'Contract', office: true },
  { no: 2, name: 'Tender', office: true },
  { no: 3, name: 'Programme', office: false },
  { no: 4, name: 'Drawings and Specs', office: false },
  { no: 5, name: 'Insurance', office: true },
  { no: 6, name: 'Safety', office: false },
  { no: 7, name: 'Quality', office: false },
  { no: 8, name: 'Procurement', office: true },
  { no: 9, name: 'Correspondence', office: true },
  { no: 10, name: 'Claims', office: true },
  { no: 11, name: 'Diaries and Photos', office: false },
  { no: 12, name: 'Closeout', office: false },
];

export function folderName(no: number | null | undefined): string {
  const f = FOLDERS.find((x) => x.no === no);
  return f ? `${String(f.no).padStart(2, '0')} ${f.name}` : '—';
}

export interface TemplateItem {
  id: string;
  module_key: string;
  kind: TemplateKind;
  category: string | null;
  title: string;
  detail: string | null;
  priority: Priority | null;
  min_tier: Tier;
  owner_role: Owner | null;
  due_offset_days: number | null;
  unit: string | null;
  par_level: number | null;
  folder_no: number | null;
  sort: number;
  active: boolean;
  origin: 'template' | 'manual' | 'contract';
}

/** How many live items each kind holds — the editor's header, and the acceptance counts later. */
export function countsByKind(items: readonly Pick<TemplateItem, 'kind' | 'active'>[]): Record<TemplateKind, number> {
  const out = Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, 0])) as Record<TemplateKind, number>;
  for (const it of items) if (it.active) out[it.kind] += 1;
  return out;
}

/** Live items first, in sort order then by category and title; retired ones after, so nothing hides. */
export function orderItems<T extends Pick<TemplateItem, 'active' | 'sort' | 'category' | 'title'>>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) =>
    Number(b.active) - Number(a.active)
    || a.sort - b.sort
    || (a.category ?? '').localeCompare(b.category ?? '')
    || a.title.localeCompare(b.title));
}

/** What is wrong with an item before it is saved — the editor's own check; the database has the same rules. */
export function itemProblems(it: Pick<TemplateItem, 'kind' | 'title' | 'folder_no' | 'par_level' | 'unit'>): string[] {
  const out: string[] = [];
  if (!it.title.trim()) out.push('a title');
  if ((it.kind === 'document' || it.kind === 'folder') && it.folder_no == null) out.push('which folder (1–12)');
  if (it.kind === 'consumable' && it.par_level != null && !it.unit?.trim()) out.push('a unit for the par level');
  return out;
}
