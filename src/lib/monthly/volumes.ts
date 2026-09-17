/**
 * Splitting a month's bundle into parts. Pure, relative imports only.
 *
 * The dockets are frozen bytes — a day with twenty photographs is 25 MB and
 * cannot be made smaller without changing the record — so a busy month is
 * hundreds of megabytes: over the exports bucket's per-file limit, and too big
 * for a phone or an email anyway. So the month is bound in parts, in date
 * order, each under a budget, and every part carries the whole month's index.
 */

/** Leaves headroom under the bucket's 50 MB per-file limit for the cover and merge overhead. */
export const VOLUME_BUDGET_BYTES = 40 * 1024 * 1024;

/** The bucket's hard limit; a part over this cannot be stored. */
export const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * Consecutive groups of docket indices, in order, each within the budget. A
 * docket bigger than the budget on its own gets a part to itself. Nothing is
 * reordered and nothing is left out.
 */
export function planVolumes(sizes: readonly number[], budget = VOLUME_BUDGET_BYTES): number[][] {
  const volumes: number[][] = [];
  let current: number[] = [];
  let used = 0;
  sizes.forEach((size, index) => {
    if (current.length > 0 && used + size > budget) {
      volumes.push(current);
      current = [];
      used = 0;
    }
    current.push(index);
    used += size;
  });
  if (current.length > 0) volumes.push(current);
  return volumes;
}

/** Where a part is stored. One part keeps the name a single bundle always had. */
export function volumePath(projectId: string, month: string, part: number, of: number): string {
  return of === 1 ? `${projectId}/monthly/${month}.pdf` : `${projectId}/monthly/${month}-part-${part}-of-${of}.pdf`;
}
