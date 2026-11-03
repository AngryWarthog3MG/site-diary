/**
 * The asset register (README R186): everything the company owns or hires — a
 * machine on the plant register, a fire extinguisher, a first-aid kit, a lead,
 * a sling, a harness, a laptop — what falls due on each, who has it, and what
 * its meter reads.
 *
 * Pure and dependency-free (relative imports, node-tested): the register
 * screen, the asset page, What's due, the printed register and the nightly
 * sweep all reach the same verdict. Dates are ISO calendar days in Perth;
 * nothing here reads a clock.
 *
 * `nextDue` is the TS twin of `app.asset_profile_next_due`, and `dueAtHours`
 * of `app.asset_profile_due_at_hours` — change both halves together.
 */
import { addDays, addInterval, type Unit } from '../forms/schedule.ts';
import { PLANT_KIND_LABEL, isPlantKind } from '../plant/checklist.ts';

export const ASSET_CLASSES = ['plant', 'fire', 'first_aid', 'electrical', 'lifting', 'ppe', 'tool', 'office', 'other'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const CLASS_LABEL: Record<AssetClass, string> = {
  plant: 'Plant and vehicles',
  fire: 'Fire equipment',
  first_aid: 'First aid',
  electrical: 'Electrical',
  lifting: 'Lifting gear',
  ppe: 'Harnesses and PPE',
  tool: 'Tools and small gear',
  office: 'Office and IT',
  other: 'Other',
};

/** What each class is for, under the picker. */
export const CLASS_HINT: Record<AssetClass, string> = {
  plant: 'Machines and vehicles — kept on the plant register, with their prestart, inspection basis and registration',
  fire: 'Extinguishers, blankets, hose reels',
  first_aid: 'Kits, eyewash, defibrillators',
  electrical: 'Leads, power boards, RCDs, power tools — tested and tagged',
  lifting: 'Slings, chains, shackles, lifting beams',
  ppe: 'Harnesses, lanyards, gas monitors',
  tool: 'Hand tools, ladders, generators, pumps without a prestart',
  office: 'Laptops, phones, printers',
  other: 'Anything else worth keeping track of',
};

export const ASSET_OWNERSHIP = ['own', 'hired', 'third_party'] as const;
export type AssetOwnership = (typeof ASSET_OWNERSHIP)[number];
export const OWNERSHIP_LABEL: Record<AssetOwnership, string> = { own: 'Own', hired: 'Hired in', third_party: "Third party's" };

export const PROFILE_KINDS = ['inspection', 'test', 'maintenance'] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];
export const PROFILE_KIND_LABEL: Record<ProfileKind, string> = { inspection: 'Inspection', test: 'Test', maintenance: 'Maintenance / service' };

export const ASSET_RECORD_KINDS = ['inspection', 'test', 'maintenance', 'repair', 'commissioning', 'decommissioning', 'other'] as const;
export type AssetRecordKind = (typeof ASSET_RECORD_KINDS)[number];
export const RECORD_KIND_LABEL: Record<AssetRecordKind, string> = {
  inspection: 'Inspection', test: 'Test', maintenance: 'Maintenance / service', repair: 'Repair',
  commissioning: 'Commissioning', decommissioning: 'Decommissioning', other: 'Other',
};

export const OUTCOME_LABEL = { pass: 'Pass', pass_with_actions: 'Pass, with actions', fail: 'Fail' } as const;
export type Outcome = keyof typeof OUTCOME_LABEL;

export const METER_UNITS = ['hours', 'km'] as const;
export type MeterUnit = (typeof METER_UNITS)[number];

/** A row of `public.asset_register`, as the view returns it. */
export interface AssetRow {
  id: string;
  org_id: string;
  plant_id: string | null;
  asset_class: AssetClass;
  name: string;
  asset_no: string | null;
  barcode: string | null;
  category: string | null;
  make_model: string | null;
  serial_no: string | null;
  ownership: AssetOwnership;
  supplier: string | null;
  hire_ref: string | null;
  location: string | null;
  purchased_on: string | null;
  notes: string | null;
  active: boolean;
  retired_reason: string | null;
}

export interface ProfileRow {
  id: string;
  asset_id: string;
  kind: ProfileKind;
  label: string;
  basis: string | null;
  every: number | null;
  unit: Unit | null;
  first_due_on: string | null;
  every_hours: number | null;
  start_hours: number | null;
  assigned_to: string | null;
  priority: 'normal' | 'high' | 'critical';
  active: boolean;
  notes: string | null;
}

/** What discharges a profile: a record on either table that names it. */
export interface DoneFacts {
  profile_id: string | null;
  done_on: string;
  next_due_on: string | null;
  meter: number | null;
}

export interface MeterFacts {
  reading: number;
  read_on: string;
  source: 'reading' | 'prestart' | 'service';
}

export interface CheckoutFacts {
  id: string;
  asset_id: string;
  holder_name: string;
  project_code: string | null;
  out_at: string;
  due_back_on: string | null;
  in_at: string | null;
}

/** The category as it reads: a machine's plant kind spelled out, anything else as typed. */
export function categoryLabel(a: Pick<AssetRow, 'asset_class' | 'category'>): string | null {
  if (a.asset_class === 'plant' && a.category && isPlantKind(a.category)) return PLANT_KIND_LABEL[a.category];
  return a.category;
}

/** The last doing of a profile: the latest record naming it. */
export function lastDone(profileId: string, done: readonly DoneFacts[]): DoneFacts | null {
  let best: DoneFacts | null = null;
  for (const d of done) {
    if (d.profile_id !== profileId) continue;
    if (!best || d.done_on > best.done_on) best = d;
  }
  return best;
}

/**
 * A calendar profile's next due: the first due until one is done, then an interval from the last doing — unless the
 * inspector set a date on it, which wins. Null for a retired or meter-only profile. Twin of `app.asset_profile_next_due`.
 */
export function nextDue(p: Pick<ProfileRow, 'active' | 'every' | 'unit' | 'first_due_on'>, last: Pick<DoneFacts, 'done_on' | 'next_due_on'> | null): string | null {
  if (!p.active || p.every == null || p.unit == null || p.first_due_on == null) return null;
  if (!last) return p.first_due_on;
  if (last.next_due_on) return last.next_due_on;
  return addInterval(last.done_on, p.every, p.unit);
}

/**
 * The reading a meter profile is next due at: the cycle's start, then the last doing's reading, plus the interval.
 * A doing with no reading recorded does not move the cycle — the start stands. Twin of `app.asset_profile_due_at_hours`.
 */
export function dueAtHours(p: Pick<ProfileRow, 'active' | 'every_hours' | 'start_hours'>, lastMeter: number | null): number | null {
  if (!p.active || p.every_hours == null || p.start_hours == null) return null;
  return (lastMeter ?? p.start_hours) + p.every_hours;
}

/** The latest reading from any source: the latest day wins; on one day, the higher number. */
export function latestMeter(readings: readonly MeterFacts[]): MeterFacts | null {
  let best: MeterFacts | null = null;
  for (const r of readings) {
    if (!best || r.read_on > best.read_on || (r.read_on === best.read_on && r.reading > best.reading)) best = r;
  }
  return best;
}

/** The last doing's meter reading for a meter profile: the latest record naming it that carries one. */
export function lastDoneMeter(profileId: string, done: readonly DoneFacts[]): number | null {
  let best: DoneFacts | null = null;
  for (const d of done) {
    if (d.profile_id !== profileId || d.meter == null) continue;
    if (!best || d.done_on > best.done_on) best = d;
  }
  return best?.meter ?? null;
}

export type DueStatus = 'overdue' | 'due_soon' | 'upcoming' | 'none';
export const DUE_LABEL: Record<DueStatus, string> = { overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming', none: 'Retired' };

/** How far ahead a profile counts as "due soon" on the page and in the register: the same month the plant register uses. */
export const WARN_DAYS = 30;
/** A meter profile is "due soon" within this share of its interval, capped at this many hours. */
export const WARN_HOURS_SHARE = 0.1;
export const WARN_HOURS_CAP = 25;

export interface ProfileState {
  profile: ProfileRow;
  /** The calendar due day, when the profile has a calendar. */
  due: string | null;
  /** The reading it is due at and the latest reading, when the profile has a meter. */
  dueAt: number | null;
  reading: MeterFacts | null;
  status: DueStatus;
  /** One line for the screen: "Due 03/12/2026", "Due at 1,250 h · read 1,230 h". */
  says: string;
}

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtHours = (n: number) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 1 })} h`;

export function dateStatus(due: string | null, today: string, warnDays = WARN_DAYS): DueStatus {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due <= addDays(today, warnDays)) return 'due_soon';
  return 'upcoming';
}

export function hoursStatus(dueAt: number | null, every: number | null, reading: number | null): DueStatus {
  if (dueAt == null) return 'none';
  if (reading == null) return 'upcoming';
  if (reading >= dueAt) return 'overdue';
  const warn = Math.min(WARN_HOURS_CAP, (every ?? 0) * WARN_HOURS_SHARE);
  if (reading >= dueAt - warn) return 'due_soon';
  return 'upcoming';
}

/** The worse of two verdicts, for a profile that has both clocks. */
export function worse(a: DueStatus, b: DueStatus): DueStatus {
  const rank: Record<DueStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, none: 3 };
  return rank[a] <= rank[b] ? a : b;
}

export function profileState(p: ProfileRow, done: readonly DoneFacts[], readings: readonly MeterFacts[], today: string): ProfileState {
  const last = lastDone(p.id, done);
  const due = nextDue(p, last);
  const dueAt = dueAtHours(p, lastDoneMeter(p.id, done));
  const reading = dueAt == null ? null : latestMeter(readings);
  const byDate = p.every != null ? dateStatus(due, today) : 'none';
  const byHours = dueAt != null ? hoursStatus(dueAt, p.every_hours, reading?.reading ?? null) : 'none';
  const status = !p.active ? 'none' : p.every != null && dueAt != null ? worse(byDate, byHours) : p.every != null ? byDate : byHours;
  const parts: string[] = [];
  if (due) parts.push(`${byDate === 'overdue' ? 'Was due' : 'Due'} ${fmtDay(due)}${last?.next_due_on ? ' (as set on the last record)' : ''}`);
  if (dueAt != null) parts.push(`Due at ${fmtHours(dueAt)}${reading ? ` · read ${fmtHours(reading.reading)} on ${fmtDay(reading.read_on)}` : ' · no reading yet'}`);
  if (!p.active) parts.push('Retired');
  return { profile: p, due, dueAt, reading, status, says: parts.join(' · ') || 'Nothing due' };
}

/** The open custody on an asset, if any. */
export function custody(assetId: string, checkouts: readonly CheckoutFacts[]): CheckoutFacts | null {
  return checkouts.find((c) => c.asset_id === assetId && c.in_at == null) ?? null;
}

export function custodySays(c: CheckoutFacts | null, today: string): { text: string; tone: 'ok' | 'warn' | 'bad' | 'none' } {
  if (!c) return { text: 'In', tone: 'none' };
  const late = c.due_back_on != null && c.due_back_on < today;
  return {
    text: `With ${c.holder_name}${c.project_code ? ` on ${c.project_code}` : ''}${c.due_back_on ? ` · back ${fmtDay(c.due_back_on)}` : ''}`,
    tone: late ? 'bad' : 'ok',
  };
}

export interface AssetVerdict {
  asset: AssetRow;
  profiles: ProfileState[];
  /** The worst profile verdict on the asset. */
  status: DueStatus;
  /** The nearest thing due, for the one line a list shows. */
  next: ProfileState | null;
  custody: CheckoutFacts | null;
  meter: MeterFacts | null;
}

export function assetVerdict(asset: AssetRow, profiles: readonly ProfileRow[], done: readonly DoneFacts[], readings: readonly MeterFacts[], checkouts: readonly CheckoutFacts[], today: string): AssetVerdict {
  const states = profiles.filter((p) => p.asset_id === asset.id && p.active).map((p) => profileState(p, done, readings, today));
  let status: DueStatus = 'none';
  let next: ProfileState | null = null;
  for (const s of states) {
    if (next == null) { next = s; status = s.status; continue; }
    const w = worse(status, s.status);
    if (w !== status || (s.status === status && (s.due ?? '9999') < (next.due ?? '9999'))) { next = s; status = w; }
  }
  return { asset, profiles: states, status, next, custody: custody(asset.id, checkouts), meter: latestMeter(readings) };
}

export interface AssetSummary { inService: number; retired: number; overdue: number; dueSoon: number; out: number; hired: number; noProfile: number }

export function summarise(verdicts: readonly AssetVerdict[]): AssetSummary {
  const s: AssetSummary = { inService: 0, retired: 0, overdue: 0, dueSoon: 0, out: 0, hired: 0, noProfile: 0 };
  for (const v of verdicts) {
    if (!v.asset.active) { s.retired += 1; continue; }
    s.inService += 1;
    if (v.status === 'overdue') s.overdue += 1;
    if (v.status === 'due_soon') s.dueSoon += 1;
    if (v.custody) s.out += 1;
    if (v.asset.ownership !== 'own') s.hired += 1;
    if (v.profiles.length === 0) s.noProfile += 1;
  }
  return s;
}

/** The order the register lists them in: overdue first, then due soon, then by class and name; retired last. */
export function sortVerdicts(verdicts: readonly AssetVerdict[]): AssetVerdict[] {
  const rank: Record<DueStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, none: 2 };
  const cls = (c: AssetClass) => ASSET_CLASSES.indexOf(c);
  return [...verdicts].sort((a, b) =>
    Number(!a.asset.active) - Number(!b.asset.active)
    || rank[a.status] - rank[b.status]
    || cls(a.asset.asset_class) - cls(b.asset.asset_class)
    || a.asset.name.localeCompare(b.asset.name, undefined, { numeric: true }));
}

/** Every word of the query must appear somewhere on the asset: name, number, barcode, serial, category, make, location, holder, supplier. */
export function assetMatches(v: AssetVerdict, query: string, cls: AssetClass | null): boolean {
  if (cls && v.asset.asset_class !== cls) return false;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const a = v.asset;
  const hay = [a.name, a.asset_no, a.barcode, a.serial_no, categoryLabel(a), a.make_model, a.location, a.supplier, a.hire_ref, v.custody?.holder_name, v.custody?.project_code, CLASS_LABEL[a.asset_class]]
    .filter((s): s is string => Boolean(s)).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * What a class usually has falling due, offered when a profile is added — each with the clause it stands on.
 * An offer, never a rule: the office edits the interval, and the standard or the supplier has the last word.
 */
export interface ProfilePreset { label: string; kind: ProfileKind; basis: string; every?: number; unit?: Unit; every_hours?: number; classes: AssetClass[] }
export const PROFILE_PRESETS: readonly ProfilePreset[] = [
  { label: 'Test and tag', kind: 'test', every: 3, unit: 'month', basis: 'AS/NZS 3760:2022 Table 4 — construction and demolition sites: 3-monthly', classes: ['electrical'] },
  { label: 'RCD trip-time test', kind: 'test', every: 3, unit: 'month', basis: 'AS/NZS 3760:2022 Table 4 — portable RCD on a construction site: push-button test daily, operating-time test 3-monthly', classes: ['electrical'] },
  { label: 'Extinguisher 6-monthly service', kind: 'inspection', every: 6, unit: 'month', basis: 'AS 1851-2012 Section 10 — portable fire extinguishers, 6-monthly routine service', classes: ['fire'] },
  { label: 'First-aid kit contents check', kind: 'inspection', every: 3, unit: 'month', basis: 'Code of Practice: First aid in the workplace (WA) — check the kit regularly and restock after use', classes: ['first_aid'] },
  { label: 'Lifting gear periodic inspection', kind: 'inspection', every: 3, unit: 'month', basis: 'AS 2550.1 / AS 3775.2 — periodic inspection by a competent person; the standard or the supplier sets the interval', classes: ['lifting'] },
  { label: 'Harness and lanyard inspection', kind: 'inspection', every: 6, unit: 'month', basis: 'AS/NZS 1891.4:2009 cl. 9 — inspected by a competent person at least every six months', classes: ['ppe'] },
  { label: 'Gas monitor bump test and calibration', kind: 'test', every: 6, unit: 'month', basis: "The manufacturer's schedule — bump test before use, calibration as the manufacturer states", classes: ['ppe'] },
  { label: 'Service by hours', kind: 'maintenance', every_hours: 250, basis: "The manufacturer's service schedule", classes: ['plant', 'tool'] },
  { label: 'Annual inspection', kind: 'inspection', every: 12, unit: 'month', basis: 'WHS (General) Regs 2022 (WA) reg. 213 — annually where neither the manufacturer nor a competent person sets an interval', classes: ['plant', 'tool', 'other'] },
];

export function presetsFor(cls: AssetClass): ProfilePreset[] {
  return PROFILE_PRESETS.filter((p) => p.classes.includes(cls));
}

/** "every 3 months", "every 250 h", "every 3 months or 250 h". */
export function describeProfile(p: Pick<ProfileRow, 'every' | 'unit' | 'every_hours'>): string {
  const parts: string[] = [];
  if (p.every != null && p.unit) parts.push(p.every === 1 ? `every ${p.unit}` : `every ${p.every} ${p.unit}s`);
  if (p.every_hours != null) parts.push(`every ${fmtHours(p.every_hours)}`);
  return parts.join(' or ');
}
