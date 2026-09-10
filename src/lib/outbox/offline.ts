/**
 * The small truths every offline path needs, kept out of any React file so
 * they can be tested without a browser.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(text);
}

/** Postgres and PostgREST say "no" in a few voices; these mean "not with your rights", not "try later". */
export function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const text = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  return code === '42501' || /row-level security|permission denied|not authori[sz]ed|forbidden/i.test(text);
}

/** A retry that finds its own work already done: the record is right, move on. */
export function isAlreadyDone(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const text = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  return code === '23505' || /already exists|duplicate key/i.test(text);
}

/** Frozen by the record itself: the thing was finished before this reached it. Nothing to retry. */
export function isFrozen(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  return /is finished|is signed|cannot be modified|cannot be added|frozen/i.test(text);
}

export function backoffMs(attempts: number): number {
  return Math.min(30 * 60 * 1000, 15_000 * 2 ** Math.min(attempts, 8));
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
