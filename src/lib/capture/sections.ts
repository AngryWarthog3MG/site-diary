import type { EntrySection } from '@/types/database';

/**
 * The six required sections, and the words that suggest one has been covered.
 *
 * This drives the chips on the recording screen — the "ambient reminder of
 * what's still uncovered" from brief §7.2. It is a listening aid, nothing
 * more: a lit chip means the supervisor said something on the subject, not
 * that a field has been extracted. Extraction (step 3) decides that, and the
 * completeness check that follows it is what actually asks the follow-up
 * question.
 */

export const SECTION_ORDER: EntrySection[] = [
  'labour',
  'plant',
  'work_items',
  'variations',
  'delays',
  'weather',
];

export const SECTION_LABELS: Record<EntrySection, string> = {
  labour: 'Labour',
  plant: 'Plant',
  work_items: 'Works',
  variations: 'Variations',
  delays: 'Delays',
  weather: 'Weather',
};

const CUES: Record<EntrySection, string[]> = {
  labour: [
    'blokes', 'bloke', 'men', 'crew', 'labourer', 'labourers', 'leading hand',
    'foreman', 'apprentice', 'hours', 'overtime', 'knocked off', 'on site',
    'started at', 'day shift', 'night shift', 'subbie', 'subbies', 'gang',
  ],
  plant: [
    'excavator', 'bobcat', 'ewp', 'roller', 'telehandler', 'water cart',
    'skid steer', 'dozer', 'grader', 'crane', 'truck', 'trucks', 'float',
    'wet hire', 'dry hire', 'idle', 'plant', 'machine', 'breakdown',
  ],
  work_items: [
    'poured', 'pour', 'formed', 'formwork', 'trimmed', 'laid', 'installed',
    'completed', 'finished', 'stripped', 'backfilled', 'excavated', 'compacted',
    'per cent', 'percent', 'complete', 'kerb', 'subgrade', 'topsoil', 'pipe',
  ],
  variations: [
    'variation', 'vr', 'extra work', 'directed', 'direction', 'instructed',
    'instruction', 'additional', 'out of scope', 'claim', 'day works', 'daywork',
  ],
  delays: [
    'delay', 'delayed', 'standdown', 'stood down', 'stand down', 'waiting on',
    'held up', 'lost time', 'no access', 'couldn’t get', 'couldn\'t get',
    'shut down', 'stopped work', 'down time', 'downtime',
  ],
  weather: [
    'rain', 'raining', 'rained', 'wet', 'showers', 'storm', 'wind', 'windy',
    'hot', 'heat', 'humid', 'degrees', 'fog', 'lightning', 'dried out',
  ],
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS: Array<[EntrySection, RegExp]> = SECTION_ORDER.map((section) => [
  section,
  new RegExp(`\\b(${CUES[section].map(escape).join('|')})\\b`, 'i'),
]);

/**
 * Names get said in parts. A supervisor says "Danny and Kel were on the deck",
 * never "Danny Rowe and Kel Brady", so match the whole term and each word of
 * it separately. Numeric fragments are dropped — "35" out of "Kobelco 35"
 * would fire on every quantity in the entry.
 */
function matchableParts(terms: readonly string[]): string[] {
  const parts = new Set<string>();
  for (const term of terms) {
    const clean = term.trim();
    if (clean.length >= 3) parts.add(clean);
    for (const word of clean.split(/\s+/)) {
      if (word.length >= 3 && /[a-z]/i.test(word)) parts.add(word);
    }
  }
  return [...parts];
}

function mentions(transcript: string, terms: readonly string[]): boolean {
  return matchableParts(terms).some((part) =>
    new RegExp(`\\b${escape(part)}\\b`, 'i').test(transcript),
  );
}

/**
 * Which sections the transcript so far has touched.
 *
 * `extraTerms` carries the project's own vocabulary — crew names and plant
 * items straight off the diary — so "Danny and Kel were on the deck" lights
 * Labour without anyone saying the word "labour".
 */
export function detectSections(
  transcript: string,
  extraTerms: { labour?: readonly string[]; plant?: readonly string[] } = {},
): Set<EntrySection> {
  const found = new Set<EntrySection>();
  if (!transcript.trim()) return found;

  for (const [section, pattern] of PATTERNS) {
    if (pattern.test(transcript)) found.add(section);
  }

  if (mentions(transcript, extraTerms.labour ?? [])) found.add('labour');
  if (mentions(transcript, extraTerms.plant ?? [])) found.add('plant');

  return found;
}
