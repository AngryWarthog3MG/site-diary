/**
 * The hazardous chemicals register as facts.
 *
 * WHS (General) Regulations 2022 (WA) reg. 346 requires the register to hold
 * "the current safety data sheet for each hazardous chemical listed". Current
 * has a meaning: a sheet is reviewed and if necessary revised at least once
 * every five years, so a sheet older than that is not evidence of anything.
 * That single rule is what every badge on the screen is computed from.
 *
 * Pure and dependency-free, so the screen, the printable register and the
 * nightly check all reach the same verdict.
 */

/** A safety data sheet is reviewed at least every five years. Older is not current. */
export const SDS_REVIEW_YEARS = 5;
/** How far ahead the register warns that a sheet is coming up for review. */
export const SDS_WARN_DAYS = 90;

/** The GHS hazard classes as they appear on an Australian label. Never inferred from a name. */
export const HAZARD_CLASSES = [
  'flammable_liquid', 'flammable_solid', 'flammable_gas', 'oxidising', 'gas_under_pressure',
  'acute_toxicity', 'skin_corrosion', 'skin_irritation', 'eye_damage', 'respiratory_sensitiser',
  'skin_sensitiser', 'carcinogen', 'mutagen', 'reproductive_toxicity', 'stot_single',
  'stot_repeated', 'aspiration', 'corrosive_to_metals', 'hazardous_to_water',
] as const;
export type HazardClass = (typeof HAZARD_CLASSES)[number];

export const HAZARD_LABEL: Record<HazardClass, string> = {
  flammable_liquid: 'Flammable liquid',
  flammable_solid: 'Flammable solid',
  flammable_gas: 'Flammable gas',
  oxidising: 'Oxidising',
  gas_under_pressure: 'Gas under pressure',
  acute_toxicity: 'Acute toxicity',
  skin_corrosion: 'Skin corrosion',
  skin_irritation: 'Skin irritation',
  eye_damage: 'Serious eye damage',
  respiratory_sensitiser: 'Respiratory sensitiser',
  skin_sensitiser: 'Skin sensitiser',
  carcinogen: 'Carcinogen',
  mutagen: 'Germ cell mutagen',
  reproductive_toxicity: 'Reproductive toxicity',
  stot_single: 'Organ toxicity — single exposure',
  stot_repeated: 'Organ toxicity — repeated exposure',
  aspiration: 'Aspiration hazard',
  corrosive_to_metals: 'Corrosive to metals',
  hazardous_to_water: 'Hazardous to the water environment',
};

export function hazardLabel(value: string): string {
  return (HAZARD_LABEL as Record<string, string>)[value] ?? value;
}

export interface SdsFacts {
  id: string;
  issued_on: string;
  version: string | null;
  file_path: string | null;
  active: boolean;
}

export type SdsStatus = 'current' | 'due' | 'out_of_date' | 'no_file' | 'none';

export const SDS_STATUS_LABEL: Record<SdsStatus, string> = {
  current: 'Sheet current',
  due: 'Sheet due for review',
  out_of_date: 'Sheet out of date',
  no_file: 'Sheet recorded, file missing',
  none: 'No safety data sheet',
};

/** Add whole years to an ISO date, clamping 29 February to the 28th. */
export function addYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const md = iso.slice(4);
  const candidate = `${String(y).padStart(4, '0')}${md}`;
  if (md === '-02-29') {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (!leap) return `${String(y).padStart(4, '0')}-02-28`;
  }
  return candidate;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The sheet the register is holding: the newest active one, or none. */
export function currentSds(sheets: readonly SdsFacts[]): SdsFacts | null {
  const active = sheets.filter((s) => s.active);
  if (active.length === 0) return null;
  return active.reduce((a, b) => (a.issued_on >= b.issued_on ? a : b));
}

/** The date this sheet stops being current. */
export function sdsReviewDue(sheet: SdsFacts): string {
  return addYears(sheet.issued_on, SDS_REVIEW_YEARS);
}

/**
 * Whether the register holds a current sheet for this chemical, today.
 * A sheet with no file attached is recorded but not accessible, which is the
 * thing reg. 344 actually asks for, so it gets its own answer rather than
 * passing as current.
 */
export function sdsStatus(sheets: readonly SdsFacts[], today: string): SdsStatus {
  const sheet = currentSds(sheets);
  if (!sheet) return 'none';
  const due = sdsReviewDue(sheet);
  if (due < today) return 'out_of_date';
  if (!sheet.file_path) return 'no_file';
  if (due <= addDays(today, SDS_WARN_DAYS)) return 'due';
  return 'current';
}

/** Whether this status is one the register must act on. */
export function sdsNeedsAttention(status: SdsStatus): boolean {
  return status !== 'current';
}

export interface RegisterLine {
  productId: string;
  name: string;
  manufacturer: string | null;
  hazardClasses: string[];
  dgClass: string | null;
  location: string | null;
  quantity: string | null;
  sheets: SdsFacts[];
}

export interface RegisterVerdict extends RegisterLine {
  status: SdsStatus;
  reviewDue: string | null;
}

/** The register for one workplace, each line with the verdict on its sheet. */
export function registerFor(lines: readonly RegisterLine[], today: string): RegisterVerdict[] {
  return lines
    .map((line) => {
      const sheet = currentSds(line.sheets);
      return { ...line, status: sdsStatus(line.sheets, today), reviewDue: sheet ? sdsReviewDue(sheet) : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What the register says in one line, for the dashboard and the nightly check. */
export function registerSummary(verdicts: readonly RegisterVerdict[]): {
  total: number;
  missing: number;
  outOfDate: number;
  due: number;
  noFile: number;
  attention: number;
} {
  const count = (s: SdsStatus) => verdicts.filter((v) => v.status === s).length;
  const missing = count('none');
  const outOfDate = count('out_of_date');
  const due = count('due');
  const noFile = count('no_file');
  return { total: verdicts.length, missing, outOfDate, due, noFile, attention: missing + outOfDate + due + noFile };
}
