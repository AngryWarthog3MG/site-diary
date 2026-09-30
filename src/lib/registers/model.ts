/**
 * The printed registers (README R117): plant, hazardous chemicals with their
 * safety data sheets, and calibration. "Generate the plant register, the SDS
 * hazard register, the calibration register."
 *
 * Each is the screen's own record laid out as a document an auditor, a head
 * contractor or WorkSafe can be handed. Nothing here is typed for the
 * document: every verdict — inspection overdue, sheet out of date, out of
 * calibration — comes from the same function the screen uses, so the paper
 * cannot say something the app does not. An empty register prints as empty,
 * with what it would hold; it never prints an example.
 *
 * Pure, relative imports with extensions — node-tested.
 */
import { OWNERSHIP_LABEL, PLANT_KIND_LABEL, isPlantKind } from '../plant/checklist.ts';
import {
  BASIS_LABEL, OUTCOME_LABEL, intervalMonths, lastInspection, nextInspection, registrationStatus,
  type PlantFacts, type RecordFacts,
} from '../plant/inspections.ts';
import { SDS_STATUS_LABEL, currentSds, hazardLabel, sdsReviewDue, sdsStatus, type SdsFacts } from '../chemicals/model.ts';
import { CALIBRATION_LABEL, calibrationStatus } from '../quality/model.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'none';
export interface Cell { text: string; sub?: string | null; tone?: Tone }
export interface RegisterSection {
  heading: string;
  columns: string[];
  rows: Cell[][];
  /** Printed in place of the table when there are no rows. */
  empty: string;
}
export interface RegisterDoc {
  title: string;
  /** The clause the register answers to. */
  basis: string;
  /** One line each, under the title: the counts a reader wants first. */
  summary: string[];
  sections: RegisterSection[];
}

/** DD/MM/YYYY from an ISO day, by hand — a register is read in Perth and printed anywhere. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : '—');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------------------------------------
   Plant
   ------------------------------------------------------------------------------------------------ */

export interface PlantRow extends PlantFacts {
  id: string;
  name: string;
  kind: string | null;
  make_model: string | null;
  plant_no: string | null;
  ownership: string | null;
  supplier: string | null;
  active: boolean;
}

export interface PlantRecord extends RecordFacts {
  plant_id: string;
  performed_by_name: string | null;
  organisation: string | null;
}

/** How far ahead an inspection or a registration is "due soon" on the page. */
export const PLANT_WARN_DAYS = 30;

function registrationCell(p: PlantRow, today: string): Cell {
  const status = registrationStatus(p, today, PLANT_WARN_DAYS);
  if (status === 'not_required') return { text: 'Not required', tone: 'none' };
  if (status === 'missing') return { text: 'Required — none recorded', tone: 'bad' };
  const sub = [p.registration_no ? `No. ${p.registration_no}` : null, p.registration_expires_on ? `expires ${fmtDay(p.registration_expires_on)}` : null].filter(Boolean).join(' · ') || null;
  if (status === 'expired') return { text: 'Lapsed', sub, tone: 'bad' };
  if (status === 'expiring') return { text: 'Expiring', sub, tone: 'warn' };
  return { text: 'Registered', sub, tone: 'ok' };
}

function lastInspectionCell(records: PlantRecord[]): Cell {
  const last = lastInspection(records);
  if (!last) return { text: 'None on record', tone: 'none' };
  const who = [last.performed_by_name, last.organisation].filter((v) => v && v.trim()).join(', ');
  const outcome = last.outcome ? OUTCOME_LABEL[last.outcome] : null;
  return { text: fmtDay(last.done_on), sub: [who || null, outcome].filter(Boolean).join(' · ') || null, tone: last.outcome === 'fail' ? 'bad' : 'none' };
}

function nextInspectionCell(p: PlantRow, records: PlantRecord[], today: string): Cell {
  const next = nextInspection(p, records);
  const months = intervalMonths(p);
  const basis = [p.inspection_basis ? BASIS_LABEL[p.inspection_basis] : null, months != null ? `every ${plural(months, 'month', 'months')}` : null].filter(Boolean).join(' · ') || null;
  if (next.state === 'not_scheduled') return { text: 'No schedule set', sub: basis, tone: 'none' };
  if (next.state === 'never_inspected') return { text: 'Due now', sub: 'No inspection on record', tone: 'bad' };
  const sub = next.from === 'inspector' ? 'Date set by the inspector' : basis;
  if (next.due < today) return { text: fmtDay(next.due), sub: `Overdue · ${sub ?? ''}`.replace(/ · $/, ''), tone: 'bad' };
  if (next.due <= addDays(today, PLANT_WARN_DAYS)) return { text: fmtDay(next.due), sub: `Due soon · ${sub ?? ''}`.replace(/ · $/, ''), tone: 'warn' };
  return { text: fmtDay(next.due), sub, tone: 'ok' };
}

/**
 * The company's fleet. `jobsByPlant` is the job codes each machine is ticked
 * onto, from `project_plant`; a machine on no job prints a dash, not a guess.
 */
export function plantRegister(
  plant: readonly PlantRow[],
  records: readonly PlantRecord[],
  jobsByPlant: ReadonlyMap<string, string[]>,
  today: string,
): RegisterDoc {
  const byPlant = new Map<string, PlantRecord[]>();
  for (const r of records) byPlant.set(r.plant_id, [...(byPlant.get(r.plant_id) ?? []), r]);
  const columns = ['Plant no.', 'Machine', 'Kind', 'Owned / hired', 'Registration', 'Last inspection', 'Next inspection', 'On jobs'];
  const row = (p: PlantRow): Cell[] => {
    const recs = byPlant.get(p.id) ?? [];
    const own = p.ownership && p.ownership in OWNERSHIP_LABEL ? OWNERSHIP_LABEL[p.ownership as keyof typeof OWNERSHIP_LABEL] : dash(p.ownership);
    return [
      { text: dash(p.plant_no) },
      { text: p.name, sub: p.make_model },
      { text: isPlantKind(p.kind ?? '') ? PLANT_KIND_LABEL[p.kind as keyof typeof PLANT_KIND_LABEL] : dash(p.kind) },
      { text: own, sub: p.supplier },
      registrationCell(p, today),
      lastInspectionCell(recs),
      nextInspectionCell(p, recs, today),
      { text: (jobsByPlant.get(p.id) ?? []).slice().sort().join(', ') || '—' },
    ];
  };
  const sorted = plant.slice().sort((a, b) => (a.plant_no ?? '~').localeCompare(b.plant_no ?? '~', undefined, { numeric: true }) || a.name.localeCompare(b.name));
  const inService = sorted.filter((p) => p.active);
  const retired = sorted.filter((p) => !p.active);
  const rows = inService.map(row);
  const bad = (i: number) => rows.filter((r) => r[i].tone === 'bad').length;
  const summary = [
    `${plural(inService.length, 'machine', 'machines')} in service${retired.length ? ` · ${retired.length} retired` : ''}`,
    `Inspections: ${bad(6)} overdue or never inspected · ${rows.filter((r) => r[6].tone === 'warn').length} due within ${PLANT_WARN_DAYS} days · ${rows.filter((r) => r[6].text === 'No schedule set').length} with no schedule set`,
    `Registration: ${rows.filter((r) => r[4].tone !== 'none').length} registrable · ${bad(4)} missing or lapsed`,
  ];
  return {
    title: 'Plant register',
    basis: 'WHS (General) Regulations 2022 (WA) reg. 213 (maintenance and inspection of plant), reg. 237 (records of plant) · WHS Act 2020 (WA) s. 42 (registration)',
    summary,
    sections: [
      { heading: 'In service', columns, rows, empty: 'No plant is recorded in the register. Add machines under Plant › Plant register.' },
      ...(retired.length ? [{ heading: 'Retired — kept for the record', columns, rows: retired.map(row), empty: '' }] : []),
    ],
  };
}

/* ------------------------------------------------------------------------------------------------
   Hazardous chemicals and their safety data sheets
   ------------------------------------------------------------------------------------------------ */

export interface ChemLine {
  name: string;
  manufacturer: string | null;
  product_code: string | null;
  hazardClasses: string[];
  dgClass: string | null;
  usedFor: string | null;
  /** Where it is kept on this workplace; null for a product not on it. */
  location: string | null;
  quantity: string | null;
  sheets: SdsFacts[];
}

function sdsCells(line: ChemLine, today: string): [Cell, Cell, Cell] {
  const sheet = currentSds(line.sheets);
  const status = sdsStatus(line.sheets, today);
  const tone: Tone = status === 'current' ? 'ok' : status === 'due' ? 'warn' : 'bad';
  return [
    sheet ? { text: fmtDay(sheet.issued_on), sub: sheet.version ? `Version ${sheet.version}` : null } : { text: 'None held', tone: 'bad' },
    { text: sheet ? fmtDay(sdsReviewDue(sheet)) : '—', tone: sheet ? tone : 'none' },
    { text: SDS_STATUS_LABEL[status], tone },
  ];
}

const hazardsCell = (line: ChemLine): Cell => ({
  text: line.hazardClasses.length ? line.hazardClasses.map(hazardLabel).join('; ') : 'None recorded',
  sub: line.dgClass ? `Dangerous goods class ${line.dgClass}` : null,
  tone: 'none',
});

/** The register for one workplace, then what else the company keeps. */
export function chemicalsRegister(onSite: readonly ChemLine[], elsewhere: readonly ChemLine[], today: string): RegisterDoc {
  const byName = (a: ChemLine, b: ChemLine) => a.name.localeCompare(b.name);
  const here = onSite.slice().sort(byName);
  const rest = elsewhere.slice().sort(byName);
  const hereRows = here.map((l): Cell[] => [
    { text: l.name, sub: [l.manufacturer, l.product_code].filter((v) => v && v.trim()).join(' · ') || null },
    hazardsCell(l),
    { text: dash(l.location), sub: l.quantity ? `Quantity ${l.quantity}` : null },
    { text: dash(l.usedFor) },
    ...sdsCells(l, today),
  ]);
  const restRows = rest.map((l): Cell[] => [
    { text: l.name, sub: [l.manufacturer, l.product_code].filter((v) => v && v.trim()).join(' · ') || null },
    hazardsCell(l),
    { text: dash(l.usedFor) },
    ...sdsCells(l, today),
  ]);
  const attention = hereRows.filter((r) => r[6].tone !== 'ok').length;
  return {
    title: 'Hazardous chemicals register',
    basis: 'WHS (General) Regulations 2022 (WA) reg. 346 (register of hazardous chemicals), reg. 344 (current safety data sheet) · a sheet is current for five years from its date of issue',
    summary: [
      `${plural(here.length, 'hazardous chemical', 'hazardous chemicals')} on this workplace`,
      `Safety data sheets: ${hereRows.length - attention} current · ${attention} needing attention`,
      ...(rest.length ? [`${plural(rest.length, 'other product', 'other products')} kept by the company, not on this workplace`] : []),
    ],
    sections: [
      {
        heading: 'On this workplace',
        columns: ['Product', 'Hazards', 'Where kept', 'Used for', 'Sheet issued', 'Review due', 'Status'],
        rows: hereRows,
        empty: 'No hazardous chemicals are recorded on this workplace. Record what is used, handled or stored here under Chemicals.',
      },
      ...(rest.length ? [{
        heading: 'Kept by the company, not on this workplace',
        columns: ['Product', 'Hazards', 'Used for', 'Sheet issued', 'Review due', 'Status'],
        rows: restRows,
        empty: '',
      }] : []),
    ],
  };
}

/* ------------------------------------------------------------------------------------------------
   Calibration
   ------------------------------------------------------------------------------------------------ */

export interface CalibrationRow { calibrated_on: string; due_on: string; certificate_no: string; calibrated_by: string | null }
export interface EquipmentRow {
  id: string;
  name: string;
  serial_no: string | null;
  kind: string | null;
  calibration_interval_months: number | null;
  active: boolean;
  calibrations: CalibrationRow[];
}

export const CALIBRATION_WARN_DAYS = 30;

export function calibrationRegister(equipment: readonly EquipmentRow[], today: string): RegisterDoc {
  const sorted = equipment.slice().sort((a, b) => a.name.localeCompare(b.name) || (a.serial_no ?? '').localeCompare(b.serial_no ?? ''));
  const columns = ['Equipment', 'Serial no.', 'Interval', 'Last calibrated', 'Certificate', 'Due', 'Status'];
  const row = (e: EquipmentRow): Cell[] => {
    const { status, latest } = calibrationStatus(e.calibrations, today, CALIBRATION_WARN_DAYS);
    const tone: Tone = status === 'current' ? 'ok' : status === 'due_soon' ? 'warn' : 'bad';
    const by = latest ? e.calibrations.find((c) => c.due_on === latest.due_on && c.certificate_no === latest.certificate_no)?.calibrated_by ?? null : null;
    return [
      { text: e.name, sub: e.kind },
      { text: dash(e.serial_no) },
      { text: e.calibration_interval_months != null ? plural(e.calibration_interval_months, 'month', 'months') : 'Not set' },
      latest ? { text: fmtDay(latest.calibrated_on), sub: by } : { text: 'None on record', tone: 'bad' },
      { text: latest ? dash(latest.certificate_no) : '—' },
      { text: latest ? fmtDay(latest.due_on) : '—', tone: latest ? tone : 'none' },
      { text: CALIBRATION_LABEL[status], tone },
    ];
  };
  const inUse = sorted.filter((e) => e.active);
  const retired = sorted.filter((e) => !e.active);
  const rows = inUse.map(row);
  const history = sorted
    .flatMap((e) => e.calibrations.map((c) => ({ e, c })))
    .sort((a, b) => b.c.calibrated_on.localeCompare(a.c.calibrated_on) || a.e.name.localeCompare(b.e.name));
  const count = (label: string) => rows.filter((r) => r[6].text === label).length;
  return {
    title: 'Calibration register',
    basis: 'ISO 9001:2015 cl. 7.1.5 (monitoring and measuring resources) · where the head contract requires it, Main Roads WA Specification 201',
    summary: [
      `${plural(inUse.length, 'item', 'items')} of measuring equipment in use${retired.length ? ` · ${retired.length} retired` : ''}`,
      `${count(CALIBRATION_LABEL.current)} in calibration · ${count(CALIBRATION_LABEL.due_soon)} due within ${CALIBRATION_WARN_DAYS} days · ${count(CALIBRATION_LABEL.expired)} out of calibration · ${count(CALIBRATION_LABEL.none)} with none recorded`,
    ],
    sections: [
      { heading: 'Equipment in use', columns, rows, empty: 'No measuring equipment is recorded. Add gauges, levels and meters under Quality › Calibration register.' },
      ...(retired.length ? [{ heading: 'Retired — kept for the record', columns, rows: retired.map(row), empty: '' }] : []),
      ...(history.length ? [{
        heading: 'Calibration history',
        columns: ['Equipment', 'Serial no.', 'Calibrated', 'Due', 'Certificate', 'Calibrated by'],
        rows: history.map(({ e, c }): Cell[] => [
          { text: e.name }, { text: dash(e.serial_no) }, { text: fmtDay(c.calibrated_on) }, { text: fmtDay(c.due_on) }, { text: dash(c.certificate_no) }, { text: dash(c.calibrated_by) },
        ]),
        empty: '',
      }] : []),
    ],
  };
}
