/**
 * The fixed construction glossary from brief §4 — the words a general-purpose
 * speech model reliably mangles, and which happen to be exactly the words that
 * carry the numbers. Project-specific vocabulary (crew, plant, areas,
 * suppliers) comes from `public.project_keyterms()`, which grows as the diary
 * fills; this list is the part that never changes.
 */
export const CONSTRUCTION_GLOSSARY = [
  // Concrete
  'cubes',
  'MPa',
  'slump',
  'blinding',
  'screed',
  'formwork',
  'docket',
  'agitator',
  'kicker',
  'starter bars',
  'saw cut',
  // Earthworks
  'subgrade',
  'subsoil',
  'dripline',
  'topsoil',
  'batter',
  'windrow',
  'compaction',
  'proof roll',
  // Plant
  'bobcat',
  'EWP',
  'excavator',
  'roller',
  'skid steer',
  'telehandler',
  'water cart',
  // Process and paperwork
  'standdown',
  'RFI',
  'ITP',
  'hold point',
  'witness point',
  'VR',
  'variation',
  'toolbox',
  'prestart',
  'permit to dig',
  // Elements
  'kerb',
  'sleeve',
  'headwall',
  'pit',
  'lintel',
  'haunching',
  'geofabric',
  'chainage',
] as const;

/** Deepgram caps keyterm prompting at 500 tokens across the whole request. */
const KEYTERM_TOKEN_BUDGET = 400;

function estimateTokens(term: string): number {
  // Deliberately pessimistic: one token per word plus one for the term itself.
  return term.trim().split(/\s+/).length + 1;
}

/**
 * Builds the boost list, project vocabulary first.
 *
 * Order matters because the budget truncates: a supervisor's surname is
 * unguessable and worth more than "excavator", which the model gets right
 * anyway. Deduplicated case-insensitively, and deterministically ordered so
 * the same project produces the same request every time.
 */
export function buildKeyterms(projectTerms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let budget = KEYTERM_TOKEN_BUDGET;

  for (const term of [...projectTerms, ...CONSTRUCTION_GLOSSARY]) {
    const clean = term.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 60) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    const cost = estimateTokens(clean);
    if (cost > budget) continue;

    seen.add(key);
    out.push(clean);
    budget -= cost;
  }

  return out;
}
