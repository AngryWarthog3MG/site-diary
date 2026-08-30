import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import { ExtractionProposal } from './schema.ts';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage, type ExtractionInput } from './prompt.ts';

/**
 * The extraction call (brief §8 item 3).
 *
 * One request, no branching, no agent loop — the brief is explicit about that.
 * It goes through the official Anthropic SDK rather than a hand-rolled fetch
 * so the response is schema-constrained: `output_config.format` makes a reply
 * with preamble, markdown fences or a missing key structurally impossible,
 * which is a stronger guarantee than asking for JSON in the prompt and hoping.
 *
 * The model is the one the brief names. Assistant prefill — the old way of
 * forcing a JSON-only reply — returns a 400 on it, which is the other reason
 * structured output is the right mechanism here.
 *
 * Deliberately not marked `server-only`, unlike the rest of the server code:
 * that marker throws outside Next, and the accuracy harness (§10) has to drive
 * this exact function. An eval that runs a copy of the shipping code path is
 * measuring the wrong thing. Nothing is lost — ANTHROPIC_API_KEY has no
 * NEXT_PUBLIC_ prefix, so it is never inlined into a browser bundle, and only
 * the route imports this.
 */

export const EXTRACTION_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL ?? 'claude-sonnet-4-6';

export class ExtractionError extends Error {
  /** Whether trying again later could plausibly succeed. */
  readonly retryable: boolean;

  // Written out longhand rather than as a parameter property: those emit code,
  // and Node's strip-only TypeScript support rejects them — which would stop
  // the accuracy harness importing this module at all.
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ExtractionError';
    this.retryable = retryable;
  }
}

export interface ExtractionResult {
  proposal: ExtractionProposal;
  raw: unknown;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The schema, rendered into the prompt.
 *
 * Generated from the Zod schema rather than written out by hand, so the
 * contract the model is shown and the contract its output is validated against
 * cannot drift apart.
 */
function schemaInstruction(): string {
  const schema = z.toJSONSchema(ExtractionProposal, { io: 'input' });
  return [
    '# Output',
    '',
    'Return a single JSON object and nothing else. No preamble, no explanation,',
    'no markdown fences. It must match this schema exactly — every key present,',
    'every unstated value an explicit null.',
    '',
    JSON.stringify(schema),
  ].join('\n');
}

/**
 * Parse the response body.
 *
 * Models fence JSON even when told not to, so a fence is stripped rather than
 * treated as a failure. Anything beyond that is a genuine contract breach and
 * is reported as one — a half-parsed entry is worse than none.
 */
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
    throw new ExtractionError('The model did not return usable JSON.', true);
  }
}

let cached: Anthropic | null = null;function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError('ANTHROPIC_API_KEY is not set.', false);
  }
  cached ??= new Anthropic();
  return cached;
}

export async function extractEntry(input: ExtractionInput): Promise<ExtractionResult> {
  if (!input.transcript.trim()) {
    throw new ExtractionError('There is no transcript to extract from.', false);
  }

  try {
    const response = await client().messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      // Resolving self-corrections, casual times and units is exactly the sort
      // of thing that goes wrong without a moment's reasoning.
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: `${SYSTEM_PROMPT}\n\n${schemaInstruction()}`,
          // Byte-identical on every call, so it caches across every entry on
          // every project.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserMessage(input) }],
      output_config: { effort: 'high' },
    });

    if (response.stop_reason === 'max_tokens') {
      throw new ExtractionError(
        'The transcript produced more than one response could hold. Split the recording.',
        false,
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    const parsed = ExtractionProposal.safeParse(parseJson(text));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ExtractionError(
        `The model's output did not match the contract at ${first.path.join('.') || 'the top level'}: ${first.message}`,
        true,
      );
    }

    return {
      // Back through the domain schema, which turns absent keys and the empty
      // strings that mean "not stated" into explicit nulls, so nothing
      // downstream ever meets `undefined` or a stray "".
      proposal: parsed.data,
      raw: response.content,
      model: response.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (error) {
    if (error instanceof ExtractionError) throw error;

    // Retryable and permanent failures need different handling upstream: one
    // gets tried again on the next sync, the other needs a person.
    if (error instanceof Anthropic.RateLimitError) {
      throw new ExtractionError('Rate limited. This will be retried.', true);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ExtractionError('Could not reach the API. This will be retried.', true);
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new ExtractionError('The API key was rejected.', false);
    }
    if (error instanceof Anthropic.APIError) {
      throw new ExtractionError(`Extraction failed (${error.status}): ${error.message}`, error.status >= 500);
    }

    throw new ExtractionError(
      error instanceof Error ? error.message : 'Extraction failed.',
      true,
    );
  }
}
