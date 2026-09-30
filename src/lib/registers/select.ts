/**
 * Choosing which lines a printed register carries (README R118). A register
 * handed to a head contractor shows them what is on their job, not the
 * company's whole fleet — so a print can be an extract, and an extract says so.
 * Pure.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** More lines than this in one address is a mistake, not a selection. */
export const MAX_SELECTED = 300;

/** The `ids` parameter as a set of row ids: comma-separated, uuids only, capped. Null when none was given. */
export function readIds(param: string | null | undefined): Set<string> | null {
  if (param == null || param.trim() === '') return null;
  const ids = param.split(',').map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s)).slice(0, MAX_SELECTED);
  return new Set(ids);
}

export type PrintScope = 'all' | 'job' | 'selected';

export function readScope(param: string | null | undefined, ids: Set<string> | null): PrintScope {
  if (ids) return 'selected';
  return param === 'job' ? 'job' : 'all';
}

/** The line under the title that says what this print holds — and, when it is an extract, that it is one. */
export function scopeLine(scope: PrintScope, shown: number, total: number, job: { code: string; name: string }, company: string): string {
  if (scope === 'selected') return `Extract · ${shown} of ${total} lines on the register, chosen for this print · ${job.code}`;
  if (scope === 'job') return `Extract · the ${shown} of ${total} lines on ${job.code} ${job.name} · not the whole of ${company}`;
  return `The whole company · ${total} lines · printed from ${job.code}`;
}

/** The address of a print: everything, this job's lines, or exactly these. */
export function printHref(pdf: string, projectId: string, choice: { scope: 'all' | 'job' } | { ids: readonly string[] }): string {
  const base = `${pdf}?project=${projectId}`;
  if ('ids' in choice) return `${base}&ids=${choice.ids.slice(0, MAX_SELECTED).join(',')}`;
  return choice.scope === 'job' ? `${base}&scope=job` : base;
}
