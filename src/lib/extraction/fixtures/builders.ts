import type {
  DelayItem,
  ExtractionProposal,
  LabourItem,
  PlantItem,
  PourItem,
  QuantityItem,
  SectionOutcome,
  VariationItem,
  WorkItem,
} from '../schema.ts';

/**
 * Terse constructors for the expected results.
 *
 * Every field in the contract is required-but-nullable, which is right for the
 * model and unbearable to hand-write twenty times over. These default
 * everything to null so a fixture only states what the transcript states —
 * which also means a fixture author cannot accidentally leave a value out and
 * have it read as "not stated".
 *
 * `source_quote` is left empty here and never scored by value. It is checked
 * separately, and more usefully, by asserting the model's quote appears
 * verbatim in the transcript.
 */

export const L = (person_name: string, over: Partial<LabourItem> = {}): LabourItem => ({
  person_name,
  role: null,
  area: null,
  hours: null,
  overtime_hours: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

export const P = (item: string, over: Partial<PlantItem> = {}): PlantItem => ({
  item,
  hire_type: null,
  hours: null,
  idle_hours: null,
  supplier: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

export const W = (description: string, over: Partial<WorkItem> = {}): WorkItem => ({
  area: null,
  description,
  percent_complete: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

export const V = (description: string, over: Partial<VariationItem> = {}): VariationItem => ({
  description,
  directed_by: null,
  directed_at: null,
  vr_ref: null,
  estimated_cost: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

export const D = (over: Partial<DelayItem> = {}): DelayItem => ({
  start_time: null,
  end_time: null,
  duration_mins: null,
  cause: null,
  personnel_affected: null,
  category: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

export const C = (over: Partial<PourItem> = {}): PourItem => ({
  location: null,
  volume_m3: null,
  mix_spec: null,
  supplier: null,
  docket_nos: [],
  start_time: null,
  finish_time: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

export const Q = (item_type: string, over: Partial<QuantityItem> = {}): QuantityItem => ({
  item_type,
  area: null,
  quantity: null,
  unit: null,
  source_quote: '',
  confidence: 'high',
  ...over,
});

const captured: SectionOutcome = { state: 'captured', source_quote: null };
const nil: SectionOutcome = { state: 'nil_confirmed', source_quote: null };
const gap: SectionOutcome = { state: 'gap', source_quote: null };

export const S = { captured, nil, gap };

type Sections = ExtractionProposal['sections'];

/**
 * Section states are derived from the items by default, so a fixture only
 * declares the ones that cannot be — an explicit nil, or a gap the items alone
 * would not reveal.
 */
export function proposal(
  parts: Partial<Omit<ExtractionProposal, 'sections'>> & { sections?: Partial<Sections> },
): ExtractionProposal {
  const labour = parts.labour ?? [];
  const plant = parts.plant ?? [];
  const work_items = parts.work_items ?? [];
  const variations = parts.variations ?? [];
  const delays = parts.delays ?? [];
  const weather_impact = parts.weather_impact ?? null;
  const notes = parts.notes ?? null;

  const derive = (count: number): SectionOutcome => (count > 0 ? captured : gap);

  return {
    labour,
    plant,
    work_items,
    variations,
    delays,
    pours: parts.pours ?? [],
    quantities: parts.quantities ?? [],
    weather_impact,
    notes,
    sections: {
      labour: derive(labour.length),
      plant: derive(plant.length),
      work_items: derive(work_items.length),
      variations: derive(variations.length),
      delays: derive(delays.length),
      weather: derive(weather_impact ? 1 : 0),
      ...parts.sections,
    },
  };
}
