/**
 * The closeout loop (README R93): what a job added by hand or read from its
 * contract can become the company's. The screen's helpers — which items are
 * up for a decision, a generic rewording to start from, and the names that
 * must not survive into a template. Pure, relative imports only.
 */
import type { SetupItem } from './model.ts';

export type Promotable = Pick<SetupItem, 'origin' | 'promotion_decision' | 'promoted_template_item_id'>;

/** Only what the job itself added is up for promotion; what came from the library already is not. */
export function promotable(it: Pick<SetupItem, 'origin'>): boolean {
  return it.origin === 'manual' || it.origin === 'contract';
}

/** Still to decide: the job's own items with no decision yet. */
export function undecided<T extends Promotable>(items: readonly T[]): T[] {
  return items.filter((i) => promotable(i) && i.promotion_decision == null);
}

export interface JobNames { headContractor?: string | null; projectName?: string | null }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names the job carries that a template must not: the head contractor's and the job's, as found in the text. */
export function jobSpecifics(text: string, names: JobNames): string[] {
  const found: string[] = [];
  for (const n of [names.headContractor, names.projectName]) {
    const v = n?.trim();
    if (v && new RegExp(escape(v), 'i').test(text)) found.push(v);
  }
  return found;
}

/**
 * A generic rewording to start from: the head contractor becomes "the head
 * contractor" (possessives kept), the job becomes "the job". The office
 * still reads it — this is the first draft, not the decision.
 */
export function suggestGeneric(text: string, names: JobNames): string {
  let out = text;
  const hc = names.headContractor?.trim();
  if (hc) {
    out = out.replace(new RegExp(`\\b${escape(hc)}(['’]s)?`, 'gi'), (_m, poss: string | undefined) => (poss ? 'the head contractor’s' : 'the head contractor'));
  }
  const job = names.projectName?.trim();
  if (job) out = out.replace(new RegExp(escape(job), 'gi'), 'the job');
  // A sentence that now starts with "the head contractor" keeps its capital.
  out = out.replace(/^the head contractor/, 'The head contractor').replace(/^the job/, 'The job');
  return out.replace(/\s+/g, ' ').trim();
}
