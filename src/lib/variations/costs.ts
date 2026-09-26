/**
 * Variation costing (README R104): the rate card and the build-up of costed lines behind a variation. Pure,
 * relative imports only — node-tested. The database is the record: it works out every amount (quantity × rate,
 * rounded to the cent), keeps the build-up as the variation's estimate, and freezes it once submitted. What is
 * here mirrors those rules for the screen, and proposes lines from the diary without inventing a number: a day
 * with no hours proposes a blank quantity, a person with no role or no rate proposes a blank rate, and the screen
 * asks for both.
 */

export const COST_KINDS = ['labour', 'plant', 'material', 'other'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const KIND_LABEL: Record<CostKind, string> = { labour: 'Labour', plant: 'Plant', material: 'Materials', other: 'Other' };
export const KIND_ONE: Record<CostKind, string> = { labour: 'labour', plant: 'machine', material: 'material', other: 'other cost' };
export const KIND_UNIT: Record<CostKind, string> = { labour: 'hour', plant: 'hour', material: 'each', other: 'each' };
export const UNITS = ['hour', 'day', 'week', 'each', 'm', 'm²', 'm³', 't', 'load', 'lump sum'] as const;

/** Statuses in which a build-up may still change — the rest are what was claimed. Mirrors the SQL guard. */
export const OPEN_STATUSES = ['raised', 'priced'] as const;
export function buildUpOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

export interface RateItem {
  id: string;
  org_id: string;
  project_id: string | null;
  kind: CostKind;
  label: string;
  plant_id: string | null;
  unit: string;
  rate: number;
  notes: string | null;
  active: boolean;
}

export interface CostLine {
  id: string;
  register_id: string;
  kind: CostKind;
  description: string;
  person_name: string | null;
  plant_id: string | null;
  rate_item_id: string | null;
  source_entry_id: string | null;
  /** The diary row it came from — a day can record one variation on more than one row. */
  source_variation_id: string | null;
  work_date: string | null;
  quantity: number | null;
  unit: string;
  rate: number | null;
  amount: number | null;
  note: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** What the database will make of a line: quantity × rate to the cent, or nothing if either is blank. */
export function lineAmount(quantity: number | null, rate: number | null): number | null {
  if (quantity == null || rate == null) return null;
  return round2(quantity * rate);
}

/**
 * The rates that apply on a job: its own, and the company's where the job has none of the same kind and name.
 * Live rates only. A job rate is the head contract's schedule where it differs from the company's.
 */
export function cardFor(rates: readonly RateItem[], projectId: string): Array<RateItem & { scope: 'job' | 'company' }> {
  const live = rates.filter((r) => r.active);
  const job = live.filter((r) => r.project_id === projectId);
  const taken = new Set(job.map((r) => `${r.kind}|${norm(r.label)}`));
  const company = live.filter((r) => r.project_id == null && !taken.has(`${r.kind}|${norm(r.label)}`));
  return [...job.map((r) => ({ ...r, scope: 'job' as const })), ...company.map((r) => ({ ...r, scope: 'company' as const }))]
    .sort((a, b) => COST_KINDS.indexOf(a.kind) - COST_KINDS.indexOf(b.kind) || a.label.localeCompare(b.label));
}

/** A labour rate for the role a person worked as that day — by name, ignoring case and spacing. */
export function matchLabourRate<T extends Pick<RateItem, 'kind' | 'label'>>(role: string | null | undefined, card: readonly T[]): T | null {
  const want = norm(role);
  if (!want) return null;
  return card.find((r) => r.kind === 'labour' && norm(r.label) === want) ?? null;
}

/** A plant rate for a machine: the rate that names that machine, else one whose name is the machine's. */
export function matchPlantRate<T extends Pick<RateItem, 'kind' | 'label' | 'plant_id'>>(plant: { id: string; name: string } | null, card: readonly T[]): T | null {
  if (!plant) return null;
  return card.find((r) => r.kind === 'plant' && r.plant_id === plant.id)
    ?? card.find((r) => r.kind === 'plant' && norm(r.label) === norm(plant.name))
    ?? null;
}

export interface BuildUpSummary {
  count: number;
  total: number;
  byKind: Record<CostKind, number>;
  countByKind: Record<CostKind, number>;
  /** Lines with no rate, or no quantity: left out of the total until someone says. */
  unpriced: number;
  noQuantity: number;
}

export function summarise(lines: readonly Pick<CostLine, 'kind' | 'quantity' | 'rate' | 'amount'>[]): BuildUpSummary {
  const byKind = Object.fromEntries(COST_KINDS.map((k) => [k, 0])) as Record<CostKind, number>;
  const countByKind = Object.fromEntries(COST_KINDS.map((k) => [k, 0])) as Record<CostKind, number>;
  let total = 0; let unpriced = 0; let noQuantity = 0;
  for (const l of lines) {
    countByKind[l.kind] += 1;
    if (l.rate == null) unpriced += 1;
    if (l.quantity == null) noQuantity += 1;
    const amount = l.amount ?? lineAmount(l.quantity, l.rate);
    if (amount == null) continue;
    byKind[l.kind] = round2(byKind[l.kind] + amount);
    total = round2(total + amount);
  }
  return { count: lines.length, total, byKind, countByKind, unpriced, noQuantity };
}

/** What a line still needs before it counts. Words for the screen; the database holds the same line. */
export function lineProblems(l: Pick<CostLine, 'description' | 'quantity' | 'rate' | 'kind' | 'person_name'>): string[] {
  const out: string[] = [];
  if (!l.description.trim()) out.push('what it is');
  if (l.quantity == null) out.push(l.kind === 'labour' || l.kind === 'plant' ? 'the hours' : 'the quantity');
  if (l.rate == null) out.push('a rate');
  return out;
}

/**
 * The longest a person works in a day. A variation's hours are per person (R54), so a day that says more than this
 * with two or more named was almost certainly written as the total between them. The line comes in with no hours
 * and says why — halving it would be inventing a number, and taking it as each would double the claim.
 */
export const SHIFT_MAX_HOURS = 12;

/** One day of the variation as the diary recorded it, with who worked as what on that day's labour list. */
export interface DiaryDay {
  /** The diary row: a day may record the same variation on two rows, each with its own crew and hours. */
  variationId: string;
  entryId: string;
  date: string;
  signed: boolean;
  hours: number | null;
  crew: string[];
  /** Normalised person name → role on that day's labour list (null when the list names no role). */
  roles: Record<string, string | null>;
  /** What was directed, as the diary words it. */
  description?: string | null;
}

export type ProposedLine = Omit<CostLine, 'id' | 'register_id' | 'amount'>;

/**
 * Labour lines from the diary: one per person per signed diary row, at that row's hours (a variation's hours are how
 * long it ran, per person — R54), at the rate for the role they worked as that day. A row that named nobody gives
 * one line with no name, quoting the diary so whoever prices it can see who was there. Nothing is proposed twice,
 * and unsigned days wait for their signature.
 */
export function proposeFromDiary(days: readonly DiaryDay[], existing: readonly Pick<CostLine, 'kind' | 'source_variation_id' | 'person_name'>[], card: readonly RateItem[]): ProposedLine[] {
  const have = new Set(existing.filter((l) => l.kind === 'labour' && l.source_variation_id).map((l) => `${l.source_variation_id}|${norm(l.person_name)}`));
  const out: ProposedLine[] = [];
  for (const d of days) {
    if (!d.signed) continue;
    const names = d.crew.map((n) => n.trim()).filter(Boolean);
    const people = names.length ? names : [null];
    for (const name of people) {
      const key = `${d.variationId}|${norm(name)}`;
      if (have.has(key)) continue;
      have.add(key);
      const role = name ? d.roles[norm(name)] ?? null : null;
      const rate = matchLabourRate(role, card);
      const looksLikeTotal = d.hours != null && d.hours > SHIFT_MAX_HOURS && names.length > 1;
      out.push({
        kind: 'labour',
        description: rate?.label ?? (role?.trim() || (name ? 'Labour' : 'Labour — crew not named')),
        person_name: name,
        plant_id: null,
        rate_item_id: rate?.id ?? null,
        source_entry_id: d.entryId,
        source_variation_id: d.variationId,
        work_date: d.date,
        quantity: looksLikeTotal ? null : d.hours,
        unit: 'hour',
        rate: rate?.rate ?? null,
        note: looksLikeTotal
          ? `The diary says ${d.hours} h with ${names.length} named — each, or between them? Enter ${name}'s hours.`
          : !name && d.description?.trim()
            ? `Crew not named on the day, so this is one person's hours. Diary: “${d.description.trim().slice(0, 140)}”`
            : null,
      });
    }
  }
  return out;
}

/** Lines in the order the build-up reads: by kind, then day, then who or what. */
export function orderLines<T extends Pick<CostLine, 'kind' | 'work_date' | 'person_name' | 'description'>>(lines: readonly T[]): T[] {
  return lines.slice().sort((a, b) =>
    COST_KINDS.indexOf(a.kind) - COST_KINDS.indexOf(b.kind)
    || (a.work_date ?? '9999').localeCompare(b.work_date ?? '9999')
    || (a.person_name ?? a.description).localeCompare(b.person_name ?? b.description));
}
