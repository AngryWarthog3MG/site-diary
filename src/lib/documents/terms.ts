/**
 * The words in a sentence worth searching a specification for: no question
 * scaffolding, no site-diary filler, codes kept whole. Shared by Ask's
 * documents path and the review screen's spec check, so both look for the
 * same things. Pure and unit tested.
 */

const STOP = new Set([
  'what', 'which', 'where', 'when', 'how', 'much', 'many', 'do', 'does', 'did', 'is', 'are', 'was', 'were',
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'i', 'we', 'need', 'needs', 'required',
  'require', 'there', 'any', 'about', 'say', 'says', 'spec', 'specification', 'it', 'this', 'that', 'be',
  'with', 'from', 'by', 'area', 'areas', 'today', 'completed', 'complete', 'continued', 'started', 'finished',
  'work', 'works', 'site', 'all', 'some', 'more', 'per', 'as', 'using', 'used', 'our', 'their', 'them', 'has',
  'have', 'had', 'been', 'into', 'onto', 'out', 'up', 'down', 'off', 'over', 'along', 'around', 'through',
]);

export function searchTerms(text: string, max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9.-]+/)) {
    const t = raw.replace(/^[.-]+|[.-]+$/g, '');
    if (t.length < 2 || STOP.has(t.toLowerCase())) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Singular-ish forms so "beds" finds "bed" in a plain match; crude on purpose. */
export function stemLoosely(term: string): string {
  return term.length > 4 ? term.replace(/(ies|es|s)$/i, '') : term;
}
