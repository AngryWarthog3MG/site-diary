/**
 * Extraction accuracy against the fixture set (brief §10).
 *
 *   npm run extraction:eval              # all twenty
 *   npm run extraction:eval 05 12        # just those ids
 *
 * Needs ANTHROPIC_API_KEY. Run it on every prompt change — the number that
 * matters is `invented`, which §2.4 says must be zero. Value accuracy can
 * drift a point without anyone being harmed; a single invented figure is a
 * number a supervisor signs and nobody ever questions again.
 */

import { extractEntry, EXTRACTION_MODEL } from '../src/lib/extraction/extract.ts';
import { PROMPT_VERSION } from '../src/lib/extraction/prompt.ts';
import { reconcileSections } from '../src/lib/extraction/completeness.ts';
import { scoreProposal, summarise, type Score } from '../src/lib/extraction/score.ts';
import { FIXTURES, type Fixture } from '../src/lib/extraction/fixtures/transcripts.ts';
import type { ExtractionProposal } from '../src/lib/extraction/schema.ts';

const filters = process.argv.slice(2);
const selected = filters.length
  ? FIXTURES.filter((f) => filters.some((needle) => f.id.includes(needle)))
  : FIXTURES;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set — nothing to run against.');
  process.exit(1);
}
if (selected.length === 0) {
  console.error(`No fixtures matched ${filters.join(', ')}.`);
  process.exit(1);
}

/**
 * Every source_quote must appear verbatim in the transcript. This is the
 * cheapest hallucination check there is, and it catches a failure mode the
 * field-by-field scoring cannot: a value that is right by luck, attributed to
 * words nobody said.
 */
function checkQuotes(proposal: ExtractionProposal, transcript: string): string[] {
  const haystack = transcript.toLowerCase().replace(/\s+/g, ' ');
  const bad: string[] = [];

  const check = (label: string, quote: string | null) => {
    if (!quote) return;
    const needle = quote.toLowerCase().replace(/\s+/g, ' ').trim();
    if (needle && !haystack.includes(needle)) bad.push(`${label}: "${quote}"`);
  };

  proposal.labour.forEach((i) => check(`labour/${i.person_name}`, i.source_quote));
  proposal.plant.forEach((i) => check(`plant/${i.item}`, i.source_quote));
  proposal.work_items.forEach((i) => check('work_item', i.source_quote));
  proposal.variations.forEach((i) => check('variation', i.source_quote));
  proposal.delays.forEach((i) => check('delay', i.source_quote));
  proposal.pours.forEach((i) => check('pour', i.source_quote));
  proposal.quantities.forEach((i) => check(`quantity/${i.item_type}`, i.source_quote));
  Object.entries(proposal.sections).forEach(([name, outcome]) =>
    check(`section/${name}`, outcome.source_quote),
  );

  return bad;
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log(`model  ${EXTRACTION_MODEL}`);
console.log(`prompt ${PROMPT_VERSION}`);
console.log(`fixtures ${selected.length}\n`);
console.log(`${pad('fixture', 24)} ${pad('values', 8)} ${pad('invented', 9)} ${pad('missed', 7)} quotes`);
console.log('-'.repeat(64));

const scores: Score[] = [];
const problems: string[] = [];
let errors = 0;
let badQuotes = 0;
let tokensIn = 0;
let tokensOut = 0;

for (const fixture of selected as Fixture[]) {
  try {
    const result = await extractEntry({
      transcript: fixture.transcript,
      entryDate: fixture.entryDate,
      vocabulary: fixture.vocabulary,
    });
    tokensIn += result.inputTokens;
    tokensOut += result.outputTokens;

    const { proposal } = reconcileSections(result.proposal);
    const score = scoreProposal(fixture.expected, proposal);
    scores.push(score);

    const quoteFailures = checkQuotes(proposal, fixture.transcript);
    badQuotes += quoteFailures.length;

    console.log(
      `${pad(fixture.id, 24)} ${pad(pct(score.valueAccuracy), 8)} ${pad(score.invented, 9)} ${pad(
        score.values.missed,
        7,
      )} ${quoteFailures.length === 0 ? 'ok' : `${quoteFailures.length} not verbatim`}`,
    );

    for (const failure of score.failures) {
      problems.push(
        `  ${fixture.id} ${failure.section}/${failure.item}.${failure.field} ` +
          `${failure.verdict}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`,
      );
    }
    for (const quote of quoteFailures) {
      problems.push(`  ${fixture.id} quote not in transcript — ${quote}`);
    }
  } catch (error) {
    errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${pad(fixture.id, 24)} FAILED  ${message}`);
    problems.push(`  ${fixture.id} did not run: ${message}`);
  }
}

// A run where nothing completed must never read as a perfect one: an empty
// score set summarises to 100%, which is exactly the number a broken API key
// would otherwise print.
if (scores.length === 0) {
  console.log('\n' + '='.repeat(64));
  console.log(`No fixture completed — ${errors} failed. Nothing was measured.`);
  process.exit(1);
}

const total = summarise(scores);

console.log('\n' + '='.repeat(64));
console.log(`scored            ${scores.length}/${selected.length} fixtures`);
console.log(`value accuracy    ${pct(total.valueAccuracy)}`);
console.log(`section accuracy  ${pct(total.sectionAccuracy)}`);
console.log(`invented          ${total.invented}   <- must be 0`);
console.log(`missed values     ${total.values.missed}`);
console.log(`wrong values      ${total.values.wrong}`);
console.log(`missed items      ${total.missedItems}`);
console.log(`invented items    ${total.spuriousItems}`);
console.log(`quotes not verbatim ${badQuotes}`);
console.log(`failed to run     ${errors}`);
console.log(`tokens            ${tokensIn} in / ${tokensOut} out`);

if (problems.length) {
  console.log('\nfailures:');
  problems.forEach((line) => console.log(line));
}

// A run that invents anything is a failing run, whatever the accuracy says —
// and so is one where fixtures did not complete, however well the rest scored.
process.exit(total.invented === 0 && badQuotes === 0 && errors === 0 ? 0 : 1);
