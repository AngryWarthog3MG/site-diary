import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { transcribeAudio } from '@/lib/transcription/deepgram';
import type { DictatedFields } from './dictation-merge';

/**
 * A prestart talked through instead of typed.
 *
 * Deepgram turns the recording into words; the model sorts those words into
 * the form's five fields. Every field is required-but-nullable, so "not
 * mentioned" is a positive answer rather than a missing key, and the prompt
 * forbids adding a hazard or a control nobody said — the obvious ones
 * included. The supervisor sees the result in editable fields and saves what
 * they agree with; the transcript is kept on the row as provenance.
 */
const MODEL = process.env.ANTHROPIC_QUERY_MODEL ?? 'claude-sonnet-4-6';

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  cached ??= new Anthropic();
  return cached;
}

const Fields = z.object({
  work_planned: z.string().nullable(),
  hazards: z.string().nullable(),
  plant: z.string().nullable(),
  permits: z.string().nullable(),
  notes: z.string().nullable(),
});

const SYSTEM = `A construction supervisor has spoken their morning prestart briefing. Sort what they said into the prestart form's fields. Use their own words and phrasing, tidied only for punctuation.

- work_planned: what is on today. If they name areas, keep one line per area ("Busport: mulching to the beds").
- hazards: hazards and the controls for them, one per line, each starting with "- ". Pair a control with the hazard it was said for.
- plant: plant and equipment on site today, comma separated.
- permits: permits mentioned. Only write "None today" if they said there are none.
- notes: anything else — deliveries, visitors, weather watch, who is away.

Rules that matter more than tidiness:
- Only what was said. Never add a hazard, a control, a plant item or a permit that the supervisor did not say, however obvious or usual it is.
- Anything not mentioned is null, not an empty string and not a guess.
- Names of people, places and materials stay exactly as spoken.`;

export async function dictatePrestart(
  audio: ArrayBuffer,
  mimeType: string | null,
  keyterms: readonly string[],
): Promise<{ transcript: string; fields: DictatedFields }> {
  const heard = await transcribeAudio(audio, mimeType, keyterms);
  const transcript = heard.transcript.trim();
  if (!transcript) {
    return { transcript: '', fields: { work_planned: null, hazards: null, plant: null, permits: null, notes: null } };
  }
  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: transcript }],
    output_config: { format: zodOutputFormat(Fields) },
  });
  const fields = response.parsed_output ?? { work_planned: null, hazards: null, plant: null, permits: null, notes: null };
  return { transcript, fields };
}
