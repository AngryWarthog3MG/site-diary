import 'server-only';

/**
 * Deepgram transcription.
 *
 * Nova-3 with keyterm prompting (brief §4): `keyterm` is repeated once per
 * term and is Nova-3 only — the older `keywords` parameter belongs to Nova-2
 * and earlier and is not used here.
 *
 * This is the authoritative transcript. The live stream on the recording
 * screen is display only; what lands in `entry_audio.transcript` is always the
 * batch result over the complete file, so a dropped websocket can never cost
 * the record a word.
 */

const DEEPGRAM_BASE = 'https://api.deepgram.com';

export const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL ?? 'nova-3';

export class TranscriptionError extends Error {
  readonly status?: number;

  // Longhand rather than a parameter property — see extraction/extract.ts.
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TranscriptionError';
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new TranscriptionError('DEEPGRAM_API_KEY is not set');
  return key;
}

/**
 * Query string shared by the batch and live endpoints, so both hear the same
 * vocabulary.
 *
 * `pcm` switches it to raw linear16, which is what the live socket sends: the
 * recording screen streams straight off the audio graph rather than out of
 * MediaRecorder, because iOS Safari's MediaRecorder emits fragmented MP4 that
 * the streaming endpoint will not take. The sample rate is whatever the
 * browser's AudioContext actually gave us, so it has to travel with the audio.
 */
export function listenParams(
  keyterms: readonly string[],
  pcm?: { sampleRate: number },
): URLSearchParams {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: 'en',
    smart_format: 'true',
    punctuate: 'true',
    paragraphs: 'true',
    numerals: 'true',
    filler_words: 'false',
  });

  if (pcm) {
    params.set('encoding', 'linear16');
    params.set('sample_rate', String(Math.round(pcm.sampleRate)));
    params.set('channels', '1');
  }

  for (const term of keyterms) {
    params.append('keyterm', term);
  }
  return params;
}

export interface TranscriptResult {
  transcript: string;
  provider: string;
  durationSeconds: number | null;
  confidence: number | null;
}

/** Transcribe a complete recording. */
export async function transcribeAudio(
  audio: ArrayBuffer,
  mimeType: string | null,
  keyterms: readonly string[],
): Promise<TranscriptResult> {
  const url = `${DEEPGRAM_BASE}/v1/listen?${listenParams(keyterms).toString()}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey()}`,
      'Content-Type': mimeType || 'application/octet-stream',
    },
    body: audio,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TranscriptionError(
      `Deepgram returned ${response.status}: ${body.slice(0, 300)}`,
      response.status,
    );
  }

  const json = (await response.json()) as DeepgramResponse;
  const alternative = json.results?.channels?.[0]?.alternatives?.[0];

  if (!alternative) {
    throw new TranscriptionError('Deepgram returned no transcript alternatives');
  }

  // paragraphs=true gives sentence breaks, which makes the review screen and
  // the source_quote spans in step 3 far easier to read.
  const transcript = (alternative.paragraphs?.transcript ?? alternative.transcript ?? '').trim();

  return {
    transcript,
    provider: `deepgram:${DEEPGRAM_MODEL}`,
    durationSeconds: json.metadata?.duration ?? null,
    confidence: alternative.confidence ?? null,
  };
}

/**
 * Mints a short-lived JWT so the browser can open the live websocket without
 * ever seeing the API key.
 *
 * The token goes on the URL as `access_token`, not in the
 * `Sec-WebSocket-Protocol` header — these JWTs are long enough that browsers
 * reject the handshake outright when they are sent as a subprotocol.
 */
export async function grantLiveToken(ttlSeconds = 60): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const response = await fetch(`${DEEPGRAM_BASE}/v1/auth/grant`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TranscriptionError(
      `Deepgram token grant returned ${response.status}: ${body.slice(0, 300)}`,
      response.status,
    );
  }

  const json = (await response.json()) as { access_token: string; expires_in?: number };
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? ttlSeconds };
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        paragraphs?: { transcript?: string };
      }>;
    }>;
  };
}
