/**
 * The small truths every offline path needs, kept out of any React file so
 * they can be tested without a browser.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  // supabase-js hands back plain objects — { message, name, code } — not Error
  // instances; the drill's first failure was one of those saying "Failed to
  // fetch" and being filed as a permanent failure.
  const o = error as { message?: unknown; name?: unknown } | null;
  return [o?.name, o?.message].filter((v) => typeof v === 'string').join(': ');
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(messageOf(error));
}

/** Postgres and PostgREST say "no" in a few voices; these mean "not with your rights", not "try later". */
export function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const text = messageOf(error);
  return code === '42501' || /row-level security|permission denied|not authori[sz]ed|forbidden/i.test(text);
}

/** A retry that finds its own work already done: the record is right, move on. */
export function isAlreadyDone(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const text = messageOf(error);
  return code === '23505' || /already exists|duplicate key/i.test(text);
}

/** Frozen by the record itself: the thing was finished before this reached it. Nothing to retry. */
export function isFrozen(error: unknown): boolean {
  const text = messageOf(error);
  return /is finished|is signed|cannot be modified|cannot be added|frozen/i.test(text);
}

export function backoffMs(attempts: number): number {
  return Math.min(30 * 60 * 1000, 15_000 * 2 ** Math.min(attempts, 8));
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
