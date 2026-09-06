import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchTerms } from './terms';

/**
 * The spec beside the diary. For each line the supervisor is confirming —
 * a work item, a pour, a variation — find what the job's documents require
 * for it and say so, cited, in a sentence. Shown on its own tab of the
 * review screen and never written anywhere: the supervisor sees "spec says
 * 300 mm" while confirming "we placed 250", and the record keeps what they
 * confirm. The same rule as Ask: only the passages returned, or nothing.
 */

export const SPEC_MODEL = process.env.ANTHROPIC_QUERY_MODEL ?? 'claude-sonnet-4-6';

export interface SpecCheckItem {
  key: string;
  group: 'work_items' | 'pours' | 'variations';
  text: string;
  area: string | null;
}

export interface SpecPassage {
  title: string;
  revision: string | null;
  page: number | null;
  snippet: string;
}

export interface SpecFinding {
  key: string;
  /** One or two sentences of what the documents require, or null when they say nothing that applies. */
  spec: string | null;
  citations: Array<{ document: string; revision: string | null; page: number | null }>;
  passages: SpecPassage[];
}

export interface SpecCheckResult {
  documentsSearched: number;
  findings: SpecFinding[];
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  cached ??= new Anthropic();
  return cached;
}

type Row = { document_id: string; title: string; kind: string; revision: string | null; page: number | null; chunk: string; snippet?: string };

async function passagesFor(supabase: SupabaseClient, projectId: string, item: SpecCheckItem): Promise<Array<Row & { snippet: string }>> {
  const terms = searchTerms(`${item.text} ${item.area ?? ''}`);
  if (terms.length === 0) return [];
  const seen = new Map<string, Row & { snippet: string }>();
  const add = (rows: Row[]) => {
    for (const r of rows) {
      const k = `${r.document_id}:${r.page}:${r.chunk.slice(0, 40)}`;
      if (!seen.has(k)) seen.set(k, { ...r, snippet: r.snippet ?? r.chunk.slice(0, 240) });
    }
  };
  // Full text with the terms OR'd — a work item's words rarely all sit in one clause.
  const { data: fts } = await supabase.rpc('document_search', {
    p_project_id: projectId, p_query: terms.join(' or '), p_limit: 6, p_plain: false,
  });
  add((fts ?? []) as Row[]);
  if (seen.size < 4) {
    const { data: near } = await supabase.rpc('document_search_terms', { p_project_id: projectId, p_terms: terms, p_limit: 6 });
    add((near ?? []) as Row[]);
  }
  return [...seen.values()].slice(0, 6);
}

const Findings = z.object({
  findings: z.array(
    z.object({
      key: z.string(),
      spec: z.string().nullable(),
      citations: z.array(z.object({ document: z.string(), revision: z.string().nullable(), page: z.number().nullable() })),
    }),
  ),
});

const PROMPT = `You are checking a construction site diary against the job's own documents — its specification, scope, contract, drawings, safety plan.
You are given diary lines the supervisor is about to confirm (what was done today, where) and, for each, passages a search returned from the documents. The passages are the only thing you know about the documents.
For each diary line, say in one or two sentences what the documents REQUIRE that bears on it: a depth, thickness, cover, mix, grade, standard, tolerance, spacing, material, hold point or inspection. Quote figures exactly.
Rules:
- Only from the passages given for that line. Never add a requirement, figure or standard from elsewhere, however standard it seems.
- If the passages for a line do not state a requirement that applies to it, return null for that line. Nothing is better than a stretch.
- Do not judge or compare — do not say whether the diary is right. The supervisor does that.
- Cite each figure: the document title, revision and page from the passage it came from.
- Plain text, no markdown. Australian construction English.`;

export async function specCheck(supabase: SupabaseClient, projectId: string, items: SpecCheckItem[]): Promise<SpecCheckResult> {
  const { count } = await supabase
    .from('project_documents')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'ready');
  const documentsSearched = count ?? 0;
  if (documentsSearched === 0 || items.length === 0) {
    return { documentsSearched, findings: items.map((i) => ({ key: i.key, spec: null, citations: [], passages: [] })) };
  }

  const gathered = await Promise.all(items.map(async (item) => ({ item, passages: await passagesFor(supabase, projectId, item) })));
  const withPassages = gathered.filter((g) => g.passages.length > 0);
  const findings = new Map<string, SpecFinding>();
  for (const g of gathered) {
    findings.set(g.item.key, {
      key: g.item.key,
      spec: null,
      citations: [],
      passages: g.passages.map((p) => ({ title: p.title, revision: p.revision, page: p.page, snippet: p.snippet })),
    });
  }
  if (withPassages.length === 0) return { documentsSearched, findings: [...findings.values()] };

  const input = withPassages.map((g) => ({
    key: g.item.key,
    line: `${g.item.group === 'pours' ? 'Pour' : g.item.group === 'variations' ? 'Variation' : 'Work'}: ${g.item.text}${g.item.area ? ` — ${g.item.area}` : ''}`,
    passages: g.passages.map((p, i) => ({ n: i + 1, document: p.title, revision: p.revision, page: p.page, text: p.chunk.slice(0, 1600) })),
  }));

  const response = await client().messages.parse({
    model: SPEC_MODEL,
    max_tokens: 3000,
    system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(input, null, 1).slice(0, 80_000) }],
    output_config: { format: zodOutputFormat(Findings) },
  });
  for (const f of response.parsed_output?.findings ?? []) {
    const target = findings.get(f.key);
    if (!target) continue;
    target.spec = f.spec?.trim() || null;
    target.citations = target.spec ? f.citations : [];
  }
  return { documentsSearched, findings: [...findings.values()] };
}
