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

export async function draftClaimNarrative(
  data: ClaimsData,
): Promise<{ draft: string | null; rejected?: string[]; failure?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { draft: null, failure: 'ANTHROPIC_API_KEY is not set.' };
  const client = new Anthropic();
  const { project, ...register } = data;
  const input = JSON.stringify({ project: project.name, ...register });
  const allowed = allowedNumbers(input);

  const call = async (correction?: string) => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Draft the claim skeleton for ${data.project.name}.\n\n# Claims register (signed entries only)\n\n${input}` },
    ];
    if (correction) messages.push({ role: 'user', content: correction });
    const response = await client.messages.create({
      model: CLAIMS_MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
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
