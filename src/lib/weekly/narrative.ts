import Anthropic from '@anthropic-ai/sdk';
import type { WeeklyData } from './load.ts';

/**
 * The weekly narrative (brief §6) — the third and last of the fixed API calls.
 *
 * The commentary sits ABOVE the tables and is labelled as commentary; it is
 * the first draft of a delay or variation claim, not part of the record. The
 * discipline that matters is §1.4 — never invent a number — so every numeral
 * the model writes is checked against the aggregates it was shown. A narrative
 * that mentions a figure the data does not contain is rejected and retried
 * once; if it happens again the report ships without commentary rather than
 * with an invented one.
 */

export const NARRATIVE_MODEL = process.env.ANTHROPIC_NARRATIVE_MODEL ?? 'claude-sonnet-4-6';
export const NARRATIVE_PROMPT_VERSION = 'weekly-v1';

const SYSTEM_PROMPT = `You write the weekly commentary for a construction site diary report.

Your reader is a project manager or a contract administrator. The tables below your text carry the record; your job is to say what the numbers show, in 2–3 short paragraphs of plain Australian site English. No headings, no bullet points, no markdown.

Call out, when the data supports it:
- repeat delay causes and the total time lost to them
- areas or activities that appear behind (work items lingering, days without entries)
- variations still without a VR reference — these leak money and you should say so plainly
- anything a claim would later lean on: weather standdowns, idle plant, directed work

Hard rules:
- Every number you write must appear in the data you are given. Never compute a new figure, never estimate, never round differently. If you cannot make a point without inventing a number, make the point without the number.
- Cite entry references (like KBL-2026-08-28) when pointing at a specific day.
- Do not speculate about causes the diary does not state.
- Do not praise or editorialise about people. Report, flag, and stop.
- If the week is thin — few entries, little recorded — say that in one sentence rather than padding.`;

export class NarrativeError extends Error {}

/**
 * Every numeric value the data could justify: numbers themselves, and every
 * digit group inside strings (dates, times, entry references, "160mm" in a
 * description). Membership is by numeric value, so "9", "9.0" and "9.00"
 * are the same figure.
 */
export function allowedNumbers(data: unknown): Set<number> {
  const allowed = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      allowed.add(value);
      allowed.add(Math.round(value * 100) / 100);
    } else if (typeof value === 'string') {
      for (const match of value.matchAll(/\d+(?:\.\d+)?/g)) {
        allowed.add(Number(match[0]));
        // "08" in a date is also the figure 8 in prose.
        allowed.add(Number(match[0].replace(/^0+(?=\d)/, '')));
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(data);
  return allowed;
}

/** The numerals in a narrative that the data cannot account for. */
export function unaccountedNumbers(narrative: string, allowed: Set<number>): string[] {
  const offending: string[] = [];
  for (const match of narrative.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(Number(match[0]))) offending.push(match[0]);
  }
  return [...new Set(offending)];
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new NarrativeError('ANTHROPIC_API_KEY is not set.');
  cached ??= new Anthropic();
  return cached;
}

function narrativeInput(data: WeeklyData): string {
  // The narrative sees the same aggregates the tables print — nothing more.
  // Notes and transcripts stay out: the commentary is about what the numbers
  // show, and the fewer free-text claims it can echo, the safer it is.
  const { project, ...rest } = data;
  return JSON.stringify({ project: { name: project.name, code: project.code }, ...rest });
}

export interface NarrativeResult {
  narrative: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}

async function callOnce(data: WeeklyData, correction?: string): Promise<NarrativeResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        `Write the commentary for ${data.project.name}, ${data.start} to ${data.end}.\n\n` +
        `# Aggregated data (signed entries only)\n\n${narrativeInput(data)}`,
    },
  ];
  if (correction) messages.push({ role: 'user', content: correction });

  const response = await client().messages.create({
    model: NARRATIVE_MODEL,
    // Adaptive thinking spends from the same budget as the text: a rich week
    // gives the model plenty to reason about, and 2000 was small enough that
    // thinking alone could consume it, leaving no commentary at all.
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) throw new NarrativeError('The model returned no commentary.');

  return {
    narrative: text,
    model: response.model,
    promptVersion: NARRATIVE_PROMPT_VERSION,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * One call, one corrective retry if it invents a figure, then give up.
 * Returns null rather than throwing on failure: a weekly report without
 * commentary is still a weekly report, and the route treats it that way.
 */
export async function generateNarrative(
  data: WeeklyData,
): Promise<{ result: NarrativeResult | null; rejected?: string[]; failure?: string }> {
  const allowed = allowedNumbers({
    data: narrativeInput(data),
    start: data.start,
    end: data.end,
  });

  let attempt: NarrativeResult;
  try {
    attempt = await callOnce(data);
  } catch (error) {
    // Named, not swallowed: a report without commentary should say why in
    // the route's logs rather than leaving the absence to be guessed at.
    return { result: null, failure: error instanceof Error ? error.message : String(error) };
  }

  let offending = unaccountedNumbers(attempt.narrative, allowed);
  if (offending.length === 0) return { result: attempt };

  try {
    const retry = await callOnce(
      data,
      `Your draft used figures that are not in the data: ${offending.join(', ')}. ` +
        `Rewrite the commentary using only numbers that appear in the data, or make ` +
        `those points without numerals.`,
    );
    offending = unaccountedNumbers(retry.narrative, allowed);
    if (offending.length === 0) return { result: retry };
    return { result: null, rejected: offending };
  } catch (error) {
    return {
      result: null,
      rejected: offending,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
