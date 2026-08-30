import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import type { DocketRead } from './reconcile.ts';

/**
 * Reading a concrete delivery docket photograph (brief §4, item 8).
 *
 * One vision request, same discipline as extraction: copy what is printed,
 * null what is not clearly legible, never guess a digit. A wrong docket
 * number on the record is worse than none — the docket exists precisely to
 * beat estimation, so an OCR that estimates would be self-defeating.
 *
 * Not marked `server-only`, like extract.ts: the eval script drives this exact
 * function, and the API key never reaches a browser bundle.
 */

export const OCR_MODEL = process.env.ANTHROPIC_OCR_MODEL ?? 'claude-sonnet-4-6';
export const OCR_PROMPT_VERSION = 'docket-v1';

export class DocketOcrError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'DocketOcrError';
    this.retryable = retryable;
  }
}

const nullableString = z
  .string()
  .transform((v) => (v.trim() === '' ? null : v.trim()))
  .nullable()
  .catch(null);

export const DocketReadSchema = z.object({
  docket_no: nullableString.default(null),
  volume_m3: z.number().nullable().catch(null).default(null),
  mix_spec: nullableString.default(null),
  supplier: nullableString.default(null),
  legible: z.boolean().catch(true).default(true),
  issue: nullableString.default(null),
});

const SYSTEM_PROMPT = `You read photographs of concrete delivery dockets for a construction site diary.

A delivery docket is the batching plant's printed record of one truck's load. Find and return:
- docket_no: the docket or ticket number printed by the plant. Not the order number, not the job number, not the truck registration.
- volume_m3: THIS LOAD's quantity in cubic metres (often labelled "load qty", "qty this load" or similar). Not the progressive or order total.
- mix_spec: the mix description or product code as printed (e.g. "N32", "S40 20mm 100 slump").
- supplier: the batching company's name.

Hard rules:
- Copy only what is printed. If a figure is smudged, cropped, or you are not certain of every digit, return null for that field and say why in "issue". Never guess a digit — a wrong docket number on a legal record is worse than none.
- If the photo is not a delivery docket at all, or is unreadable, set legible to false and say what you see in "issue".
- Return a single JSON object, nothing else: {"docket_no": string|null, "volume_m3": number|null, "mix_spec": string|null, "supplier": string|null, "legible": boolean, "issue": string|null}`;

function parseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new DocketOcrError('The reader did not return usable JSON.', true);
  }
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new DocketOcrError('ANTHROPIC_API_KEY is not set.', false);
  }
  cached ??= new Anthropic();
  return cached;
}

export type DocketImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export async function readDocketImage(input: {
  data: string;
  mediaType: DocketImageMediaType;
}): Promise<DocketRead> {
  try {
    const response = await client().messages.create({
      model: OCR_MODEL,
      max_tokens: 1000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: input.mediaType, data: input.data },
            },
            { type: 'text', text: 'Read this docket.' },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    const parsed = DocketReadSchema.safeParse(parseJson(text));
    if (!parsed.success) {
      throw new DocketOcrError('The reader’s output did not match the contract.', true);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof DocketOcrError) throw error;
    if (error instanceof Anthropic.RateLimitError) {
      throw new DocketOcrError('Rate limited — try again in a minute.', true);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new DocketOcrError('Could not reach the reader. Try again with signal.', true);
    }
    if (error instanceof Anthropic.APIError) {
      throw new DocketOcrError(`Docket reading failed (${error.status}).`, error.status >= 500);
    }
    throw new DocketOcrError(
      error instanceof Error ? error.message : 'Docket reading failed.',
      true,
    );
  }
}
