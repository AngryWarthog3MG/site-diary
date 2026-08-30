import type { ItemGroup } from './schema.ts';

/**
 * The pre-printed field list on the docket.
 *
 * Declared as data rather than written out seven times as JSX, so every
 * section gets the same labelling, the same tap-to-see-the-quote behaviour and
 * the same amber treatment for low confidence — and adding a field is one line
 * rather than a new form.
 */

export type FieldKind = 'text' | 'textarea' | 'number' | 'time' | 'select' | 'datetime' | 'list';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  suffix?: string;
  step?: string;
  placeholder?: string;
  /** Half-width on the docket, so short numbers sit two to a row. */
  narrow?: boolean;
}

export interface SectionDef {
  group: ItemGroup;
  title: string;
  /** Singular, for the add button and the empty state. */
  noun: string;
  /** The field that identifies an item in a list. */
  identity: string;
  fields: FieldDef[];
  blank: () => Record<string, unknown>;
}

const CONFIDENCE_BLANK = { source_quote: null, confidence: null };

export const SECTIONS: SectionDef[] = [
  {
    group: 'labour',
    title: 'Labour',
    noun: 'person',
    identity: 'person_name',
    fields: [
      { key: 'person_name', label: 'Name', kind: 'text' },
      { key: 'role', label: 'Role', kind: 'text' },
      { key: 'area', label: 'Area', kind: 'text' },
      { key: 'hours', label: 'Hours', kind: 'number', step: '0.25', narrow: true },
      { key: 'overtime_hours', label: 'Overtime', kind: 'number', step: '0.25', narrow: true },
    ],
    blank: () => ({
      person_name: '',
      role: null,
      area: null,
      hours: null,
      overtime_hours: null,
      ...CONFIDENCE_BLANK,
    }),
  },
  {
    group: 'plant',
    title: 'Plant',
    noun: 'item',
    identity: 'item',
    fields: [
      { key: 'item', label: 'Item', kind: 'text' },
      {
        key: 'hire_type',
        label: 'Hire',
        kind: 'select',
        narrow: true,
        options: [
          { value: 'wet', label: 'Wet' },
          { value: 'dry', label: 'Dry' },
        ],
      },
      { key: 'supplier', label: 'Supplier', kind: 'text', narrow: true },
      { key: 'hours', label: 'Hours', kind: 'number', step: '0.25', narrow: true },
      { key: 'idle_hours', label: 'Idle', kind: 'number', step: '0.25', narrow: true },
    ],
    blank: () => ({
      item: '',
      hire_type: null,
      hours: null,
      idle_hours: null,
      supplier: null,
      ...CONFIDENCE_BLANK,
    }),
  },
  {
    group: 'work_items',
    title: 'Works completed',
    noun: 'item',
    identity: 'description',
    fields: [
      { key: 'description', label: 'Description', kind: 'textarea' },
      { key: 'area', label: 'Area', kind: 'text', narrow: true },
      {
        key: 'percent_complete',
        label: 'Complete',
        kind: 'number',
        suffix: '%',
        step: '1',
        narrow: true,
      },
    ],
    blank: () => ({
      area: null,
      description: '',
      percent_complete: null,
      ...CONFIDENCE_BLANK,
    }),
  },
  {
    group: 'variations',
    title: 'Variations',
    noun: 'variation',
    identity: 'description',
    fields: [
      { key: 'description', label: 'Description', kind: 'textarea' },
      { key: 'vr_ref', label: 'VR ref', kind: 'text', narrow: true },
      { key: 'directed_by', label: 'Directed by', kind: 'text', narrow: true },
      { key: 'directed_at', label: 'Directed at', kind: 'datetime' },
      {
        key: 'estimated_cost',
        label: 'Est. cost',
        kind: 'number',
        suffix: '$',
        step: '1',
        narrow: true,
      },
      { key: 'photo_urls', label: 'Photos', kind: 'list' },
    ],
    blank: () => ({
      description: '',
      directed_by: null,
      directed_at: null,
      vr_ref: null,
      estimated_cost: null,
      photo_urls: [],
      ...CONFIDENCE_BLANK,
    }),
  },
  {
    group: 'delays',
    title: 'Delays',
    noun: 'delay',
    identity: 'cause',
    fields: [
      { key: 'cause', label: 'Cause', kind: 'text' },
      { key: 'start_time', label: 'From', kind: 'time', narrow: true },
      { key: 'end_time', label: 'To', kind: 'time', narrow: true },
      {
        key: 'category',
        label: 'Category',
        kind: 'select',
        narrow: true,
        options: [
          { value: 'weather', label: 'Weather' },
          { value: 'access', label: 'Access' },
          { value: 'design', label: 'Design' },
          { value: 'other', label: 'Other' },
        ],
      },
      { key: 'personnel_affected', label: 'People', kind: 'number', step: '1', narrow: true },
      { key: 'duration_mins', label: 'Minutes', kind: 'number', step: '1', narrow: true },
    ],
    blank: () => ({
      start_time: null,
      end_time: null,
      duration_mins: null,
      cause: null,
      personnel_affected: null,
      category: null,
      ...CONFIDENCE_BLANK,
    }),
  },
  {
    group: 'pours',
    title: 'Concrete',
    noun: 'pour',
    identity: 'location',
    fields: [
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'volume_m3', label: 'Volume', kind: 'number', suffix: 'm³', step: '0.1', narrow: true },
      { key: 'mix_spec', label: 'Mix', kind: 'text', narrow: true },
      { key: 'supplier', label: 'Supplier', kind: 'text', narrow: true },
      { key: 'start_time', label: 'Start', kind: 'time', narrow: true },
      { key: 'finish_time', label: 'Finish', kind: 'time', narrow: true },
      { key: 'docket_nos', label: 'Dockets', kind: 'list' },
      { key: 'docket_photo_urls', label: 'Docket photos', kind: 'list' },
    ],
    blank: () => ({
      location: null,
      volume_m3: null,
      mix_spec: null,
      supplier: null,
      docket_nos: [],
      start_time: null,
      finish_time: null,
      docket_photo_urls: [],
      ...CONFIDENCE_BLANK,
    }),
  },
  {
    group: 'quantities',
    title: 'Quantities',
    noun: 'quantity',
    identity: 'item_type',
    fields: [
      { key: 'item_type', label: 'Item', kind: 'text' },
      { key: 'quantity', label: 'Quantity', kind: 'number', step: '0.001', narrow: true },
      { key: 'unit', label: 'Unit', kind: 'text', narrow: true },
      { key: 'area', label: 'Area', kind: 'text' },
    ],
    blank: () => ({
      item_type: '',
      area: null,
      quantity: null,
      unit: null,
      ...CONFIDENCE_BLANK,
    }),
  },
];

export const SECTION_BY_GROUP = new Map(SECTIONS.map((s) => [s.group, s]));

/** Which fields hold photos, so the UI can offer a camera rather than a text box. */
export const PHOTO_FIELDS = new Set(['photo_urls', 'docket_photo_urls']);
