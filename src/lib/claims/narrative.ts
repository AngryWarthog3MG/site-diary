import Anthropic from '@anthropic-ai/sdk';
import { allowedNumbers, unaccountedNumbers } from '@/lib/weekly/narrative';
import type { ClaimsData } from './load.ts';

/**
 * The claim narrative: a first draft a contracts administrator can edit,
 * generated from the claims register and nothing else. Same discipline as
 * the weekly commentary — every numeral is checked against the register,
 * one corrective retry, then no draft rather than an invented one. It is a
 * DRAFT and says so; the signed entries it cites are the evidence.
 */

export const CLAIMS_MODEL = process.env.ANTHROPIC_NARRATIVE_MODEL ?? 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You draft the skeleton of a delay/disruption and variation claim for an Australian civil construction subcontractor, from their signed site diary's claims register.

Write for the principal's contracts administrator. Structure, in plain prose with short headed sections (plain text headings, no markdown symbols):

NOTICE OF DELAY AND DISRUPTION — summarise standdown events: dates, causes, hours and man-hours lost, citing entry serials.
DIRECTED VARIATIONS — each variation: what was directed, by whom, when, the reference, the estimated value, citing entry serials.
DAYWORKS RECORD — time-and-materials items with docket references and hours, citing entry serials.
EVIDENCE — one short paragraph: every figure above traces to a signed, hash-verified diary entry; entries are immutable and independently verifiable.

Hard rules:
- Every number must appear in the register data. Never compute, estimate, or round differently. No number is better than a wrong number.
- Cite entry serials (like SD-2026-08-26) for every event.
- Flag gaps plainly: a variation without a VR reference or a daywork without a docket weakens the claim — say so where it applies.
- No pleading, no adjectives, no legal posturing. State, cite, stop.
- Open with one line: "DRAFT for review — prepared from the signed site diary record. Not a contractual notice until reviewed and issued."`;

/** How long the whole draft may take before we stop and say so, inside the route's 240 s. */
const BUDGET_MS = 210_000;
/** One model call may take this long, once; the SDK then gives up rather than the platform cutting us off. */
const CALL_TIMEOUT_MS = 150_000;

/**
 * What the model is given: the claims register and only the claims register.
 * The variation tracker's ledger (who moved what, when) and each day's
 * description ride on ClaimsData for the screen; they are not claim figures,
 * they carry timestamps full of numerals, and they made the input several
 * times longer — which is how the draft came to outrun the route's limit.
 */
export function narrativeInput(data: ClaimsData): string {
  const { project, delays, variations, dayworks } = data;
  return JSON.stringify({
    project: project.name,
    // Rows and the register's own totals: the office reads hours and man-hours lost off the
    // register, and the numeral check refuses any figure the model works out for itself.
    delays: { rows: delays.rows, total_minutes: delays.totalMinutes, total_hours: delays.totalHours, man_hours_lost: delays.manHoursLost, by_category: delays.byCategory },
    variations: {
      rows: variations.rows,
      total_estimated_cost: variations.totalCost,
      register: variations.register.map((r) => ({
        number: r.seq, title: r.title, vr_ref: r.vr_ref, status: r.status, raised_on: r.raised_on,
        estimated_cost: r.estimated_cost, agreed_cost: r.agreed_cost, submitted_on: r.submitted_on, decided_on: r.decided_on, paid_on: r.paid_on,
        hours: r.hours, crew: r.crew, days: r.mentions.map((m) => ({ date: m.date, entry_no: m.entry_no, signed: m.signed, hours: m.hours })),
      })),
      unreferenced: variations.unreferenced,
    },
    dayworks: { rows: dayworks.rows, total_hours: dayworks.totalHours, missing_dockets: dayworks.missingDockets },
  });
}

export async function draftClaimNarrative(
  data: ClaimsData,
): Promise<{ draft: string | null; rejected?: string[]; failure?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { draft: null, failure: 'ANTHROPIC_API_KEY is not set.' };
  const client = new Anthropic({ timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
  const started = Date.now();
  const input = narrativeInput(data);
  const allowed = allowedNumbers(input);

  const call = async (correction?: string) => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Draft the claim skeleton for ${data.project.name}.\n\n# Claims register (signed entries only)\n\n${input}` },
    ];
    if (correction) messages.push({ role: 'user', content: correction });
    // No extended thinking here: measured on a register this size, thinking took
    // 64 s for a draft the plain call wrote in 27 s at the same length, and the
    // figures are checked by code below, not by the model's deliberation.
    const response = await client.messages.create({
      model: CLAIMS_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  };

  try {
    let draft = await call();
    let offending = unaccountedNumbers(draft, allowed);
    if (offending.length === 0) return { draft };
    // One corrective retry — but not if it would run us past the budget; a
    // withheld draft with a clear message beats a platform timeout with none.
    if (Date.now() - started > BUDGET_MS - CALL_TIMEOUT_MS) return { draft: null, rejected: offending };
    draft = await call(
      `Your draft used figures not present in the register: ${offending.join(', ')}. ` +
        `Rewrite using only figures from the register, or make the point without numerals.`,
    );
    offending = unaccountedNumbers(draft, allowed);
    if (offending.length === 0) return { draft };
    return { draft: null, rejected: offending };
  } catch (error) {
    return { draft: null, failure: error instanceof Error ? error.message : String(error) };
  }
}
