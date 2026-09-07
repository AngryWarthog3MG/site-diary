/**
 * What a model failure means in plain words, for the person on site.
 *
 * The API's own messages are written for developers ("credit balance is too
 * low", "invalid_request_error"). The supervisor needs to know two things:
 * whether their recording is safe (always — it is stored before anything is
 * sent to a model) and whether the fix is theirs, the office's, or nobody's.
 */
export type ModelFailure = {
  /** Plain sentence for the screen. */
  message: string;
  /** Whether retrying later is likely to work without anyone doing anything. */
  retryable: boolean;
  /** Short code for the error digest. */
  code: 'no_credit' | 'rate_limited' | 'unreachable' | 'bad_key' | 'overloaded' | 'other';
};

export function explainModelError(error: unknown): ModelFailure {
  const text = (error instanceof Error ? error.message : String(error)) || '';
  const status = (error as { status?: number } | null)?.status;
  if (/credit balance is too low|purchase credits|Plans & Billing/i.test(text)) {
    return {
      code: 'no_credit',
      retryable: false,
      message:
        'The AI service has run out of credit. Your recording and transcript are safe; nothing is lost. ' +
        'The office needs to top up the Anthropic account (Plans & Billing), then tap Write it up again.',
    };
  }
  if (status === 429 || /rate limit/i.test(text)) {
    return { code: 'rate_limited', retryable: true, message: 'The AI service is busy. It will be retried in a minute; nothing is lost.' };
  }
  if (status === 529 || /overloaded/i.test(text)) {
    return { code: 'overloaded', retryable: true, message: 'The AI service is overloaded right now. It will be retried; nothing is lost.' };
  }
  if (status === 401 || /API key was rejected|authentication/i.test(text)) {
    return { code: 'bad_key', retryable: false, message: 'The AI service rejected the app’s key. The office needs to check the Anthropic key in the deployment.' };
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|Could not reach/i.test(text)) {
    return { code: 'unreachable', retryable: true, message: 'Could not reach the AI service. It will be retried; nothing is lost.' };
  }
  return { code: 'other', retryable: true, message: 'The AI step failed. Your recording is safe; try again in a minute.' };
}
