/**
 * Inspections as facts: the kinds, the standard templates a company starts
 * from, what an item and a finding are, and how a template is written by
 * hand. The database keeps the same "at least one item answered" rule.
 */

export const INSPECTION_KINDS = ['site', 'environmental', 'quality', 'plant', 'other'] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];
export const KIND_LABEL: Record<InspectionKind, string> = {
  site: 'Site walk', environmental: 'Environmental', quality: 'Quality', plant: 'Plant and equipment', other: 'Other',
};

export type ItemResult = 'ok' | 'issue' | 'na';
export const RESULT_LABEL: Record<ItemResult, string> = { ok: 'OK', issue: 'Issue', na: 'N/A' };

export interface TemplateItem { key: string; label: string }
export interface InspectionItem extends TemplateItem {
  result: ItemResult | null;
  note: string | null;
  photo_urls: string[];
}

export interface BuiltInTemplate { key: string; name: string; kind: InspectionKind; items: string[] }

/** What a civil crew walks most weeks. A company edits or adds its own. */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  { key: 'site_walk', name: 'Weekly site walk', kind: 'site', items: [
    'Housekeeping — walkways clear, materials stacked, rubbish contained',
    'Access and egress — gates, roads, pedestrian routes separated from plant',
    'Excavations — battered or shored, edge protection, ladders, spoil back from the edge',
    'Edges and falls — barriers where a fall over 2 m is possible',
    'Plant and traffic — spotters, exclusion zones, reversing alarms, traffic control in place',
    'Services — DBYD current, marked, potholed before digging',
    'Electrical — leads tagged and off the ground, RCDs tested, no damaged tools',
    'PPE — worn as the SWMS says',
    'Signage — site entry, hazards, speed, emergency numbers',
    'Emergency — muster point known, first aid kit stocked, fire extinguisher in date',
    'Chemicals and fuel — stored, bunded, SDS available',
    'Amenities — toilet, water, shade, hand washing',
  ] },
  { key: 'environmental', name: 'Environmental check', kind: 'environmental', items: [
    'Dust — suppression in use, roads watered, stockpiles covered or damped',
    'Sediment — silt fences and controls in place and maintained',
    'Spills — spill kit stocked, no leaks under plant, refuelling bunded',
    'Waste — bins, segregation, no burning, nothing in drains',
    'Noise and hours — within the permitted hours, mufflers fitted',
    'Water — no discharge to drains or creek, pumps to a settling area',
    'Trees and vegetation — protection zones fenced, no storage under canopies',
    'Heritage — no disturbance outside the approved footprint',
  ] },
  { key: 'quality', name: 'Quality check', kind: 'quality', items: [
    'Set-out — pegs and levels checked against drawings',
    'Subgrade — proof rolled, no soft spots, compaction tested',
    'Materials — dockets and certificates on file, right material in the right place',
    'Drainage — grades, joints, bedding and backfill as specified',
    'Concrete — dockets, slump, test cylinders, cure',
    'Compaction — layer thickness, moisture, test results',
    'Hold points — released before covering up',
    'As-builts — measurements taken before backfill',
  ] },
  { key: 'plant_audit', name: 'Plant and equipment audit', kind: 'plant', items: [
    'Prestart checks being done and signed each day',
    'Guards and covers fitted, no leaks',
    'Fire extinguisher fitted and in date',
    'Seat belt, ROPS/FOPS, mirrors, cameras',
    'Reversing alarm and lights working',
    'Operator ticketed and inducted',
    'Attachments — pins, locks, hoses',
    'Service and inspection dates current (stickers or logbook)',
    'Tagged-out plant isolated and not in use',
  ] },
];

/** A template typed one item per line, keyed so the record survives a reword. */
export function templateFromLines(text: string): TemplateItem[] {
  const seen = new Set<string>();
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((label, i) => {
    let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `item_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i + 1}`;
    seen.add(key);
    return { key, label };
  });
}

export function builtInItems(t: BuiltInTemplate): TemplateItem[] {
  return templateFromLines(t.items.join('\n'));
}

function asResult(v: unknown): ItemResult | null {
  return v === 'ok' || v === 'issue' || v === 'na' ? v : null;
}

/** Stored JSON → items, tolerant. */
export function readItems(json: unknown): InspectionItem[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      key: typeof r.key === 'string' && r.key ? r.key : `item_${i + 1}`,
      label: typeof r.label === 'string' ? r.label : '',
      result: asResult(r.result),
      note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
      photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls.filter((p): p is string => typeof p === 'string') : [],
    };
  });
}

export function readTemplateItems(json: unknown): TemplateItem[] {
  return readItems(json).map(({ key, label }) => ({ key, label }));
}

export const answered = (items: readonly InspectionItem[]) => items.filter((i) => i.result != null).length;
export const findings = (items: readonly InspectionItem[]) => items.filter((i) => i.result === 'issue');

export interface ActionFacts { due_on: string | null; done_at: string | null }
export function actionOverdue(a: ActionFacts, today: string): boolean {
  return a.done_at == null && a.due_on != null && a.due_on < today;
}
