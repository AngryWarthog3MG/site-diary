/**
 * What gets checked on a machine before it starts for the day.
 *
 * One list per kind of plant, built from the items every walk-around covers
 * plus the ones that only make sense on that machine — a quick hitch on an
 * excavator, safety chains on a trailer, a boom on the vac gear. Each check
 * is answered OK, Defect or N/A; nothing is pre-answered, and a signed
 * prestart keeps the labels as they read that morning.
 */
export const PLANT_KINDS = [
  'excavator', 'vac_truck', 'vac_trailer', 'truck', 'roller', 'small_plant', 'other',
] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

export const PLANT_KIND_LABEL: Record<PlantKind, string> = {
  excavator: 'Excavator',
  vac_truck: 'Vac truck',
  vac_trailer: 'Vac trailer',
  truck: 'Truck / ute',
  roller: 'Roller / compactor',
  small_plant: 'Small plant',
  other: 'Other plant',
};

export const OWNERSHIP_LABEL = { own: 'Own', dry_hire: 'Dry hire', wet_hire: 'Wet hire' } as const;
export type Ownership = keyof typeof OWNERSHIP_LABEL;

export interface CheckItem { key: string; label: string }
export type CheckResult = 'ok' | 'defect' | 'na';
/** One check as stored: the label frozen with the answer. */
export interface StoredCheck extends CheckItem { result: CheckResult }

const COMMON_START: CheckItem[] = [
  { key: 'walkaround', label: 'Walk-around: no visible damage, loose parts or leaks' },
  { key: 'fluids', label: 'Engine oil, coolant and hydraulic oil at level' },
  { key: 'fuel', label: 'Fuel for the day' },
];
const COMMON_END: CheckItem[] = [
  { key: 'fire_ext', label: 'Fire extinguisher fitted and in date' },
  { key: 'service', label: 'Service not overdue (hours / date)' },
  { key: 'defects_closed', label: 'Previous defects fixed or tagged' },
];
const SELF_PROPELLED: CheckItem[] = [
  { key: 'lights_horn', label: 'Lights, horn and reverse alarm working' },
  { key: 'seatbelt_rops', label: 'Seatbelt and ROPS/FOPS intact' },
  { key: 'mirrors_glass', label: 'Mirrors, windows and cameras clean and intact' },
  { key: 'controls', label: 'Brakes, steering and controls operate correctly' },
];

export const PLANT_CHECKS: Record<PlantKind, CheckItem[]> = {
  excavator: [
    ...COMMON_START,
    { key: 'tracks', label: 'Tracks: condition, tension, no missing pads or bolts' },
    { key: 'hydraulics', label: 'Hydraulics operate smoothly, no abnormal noise' },
    { key: 'quick_hitch', label: 'Quick hitch locked and safety pin fitted' },
    { key: 'attachments', label: 'Bucket / attachment pins and teeth secure' },
    ...SELF_PROPELLED,
    ...COMMON_END,
  ],
  vac_truck: [
    ...COMMON_START,
    { key: 'tyres', label: 'Tyres: condition and pressure, wheel nuts tight' },
    { key: 'boom_hoses', label: 'Vacuum boom, hoses and clamps secure' },
    { key: 'tank_doors', label: 'Tank, rear door and seals in good condition' },
    { key: 'water_pump', label: 'Water pump and pressure lance working' },
    { key: 'pto', label: 'PTO engages and blower runs cleanly' },
    ...SELF_PROPELLED,
    { key: 'rego', label: 'Registration and plates current' },
    ...COMMON_END,
  ],
  vac_trailer: [
    ...COMMON_START,
    { key: 'coupling', label: 'Coupling, safety chains and breakaway connected' },
    { key: 'trailer_lights', label: 'Trailer lights and indicators working' },
    { key: 'tyres', label: 'Tyres: condition and pressure, wheel nuts tight' },
    { key: 'jockey', label: 'Jockey wheel and legs stowed' },
    { key: 'boom_hoses', label: 'Vacuum boom, hoses and clamps secure' },
    { key: 'tank_doors', label: 'Tank, door and seals in good condition' },
    { key: 'water_pump', label: 'Water pump and pressure lance working' },
    { key: 'engine', label: 'Donk starts and runs cleanly, guards in place' },
    { key: 'rego', label: 'Registration and plates current' },
    ...COMMON_END,
  ],
  truck: [
    ...COMMON_START,
    { key: 'tyres', label: 'Tyres: condition and pressure, wheel nuts tight' },
    ...SELF_PROPELLED,
    { key: 'load', label: 'Load restraint, tailgate and tray secure' },
    { key: 'rego', label: 'Registration and plates current' },
    ...COMMON_END,
  ],
  roller: [
    ...COMMON_START,
    { key: 'drum', label: 'Drum / tyres: condition, scrapers fitted' },
    { key: 'vibration', label: 'Vibration and water spray working' },
    ...SELF_PROPELLED,
    ...COMMON_END,
  ],
  small_plant: [
    { key: 'walkaround', label: 'No visible damage; guards in place' },
    { key: 'leads', label: 'Leads, hoses and fittings undamaged, tags in date' },
    { key: 'estop', label: 'Emergency stop / trigger release works' },
    { key: 'fuel', label: 'Fuel or charge for the day' },
    { key: 'ppe', label: 'PPE for this tool on hand (hearing, eyes, dust)' },
    ...COMMON_END,
  ],
  other: [...COMMON_START, ...SELF_PROPELLED, ...COMMON_END],
};

export function isPlantKind(value: unknown): value is PlantKind {
  return typeof value === 'string' && (PLANT_KINDS as readonly string[]).includes(value);
}

/** Read stored checks defensively: a malformed row degrades to no checks, never a crash. */
export function readChecks(value: unknown): StoredCheck[] {
  if (!Array.isArray(value)) return [];
  const out: StoredCheck[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== 'string' || typeof r.label !== 'string') continue;
    const result = r.result === 'ok' || r.result === 'defect' || r.result === 'na' ? r.result : null;
    if (!result) continue;
    out.push({ key: r.key, label: r.label, result });
  }
  return out;
}

/** True when every check has been answered — the form's gate on signing. */
export function allAnswered(kind: PlantKind, answers: Record<string, CheckResult | undefined>): boolean {
  return PLANT_CHECKS[kind].every((item) => answers[item.key] != null);
}
