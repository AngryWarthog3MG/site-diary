import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchTerms } from './terms';

/**
 * What the crew need to know from the specification before they start.
 *
 * The prestart's "what is on today" is a sentence or three in the
 * supervisor's words: "mulching Old Brand Drive, trenching for the mainline
 * under the paving". This splits that into tasks, finds the passages that
 * bear on each, and has the model state — only from those passages — what
 * the documents require to do that task to spec: dimensions, materials,
 * standards, tolerances, hold points, inspections. Each requirement is cited.
 * The supervisor keeps what applies; it goes on the prestart and its PDF.
 */

const SPLIT_MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL ?? 'claude-haiku-4-5';
const SPEC_MODEL = process.env.ANTHROPIC_QUERY_MODEL ?? 'claude-sonnet-4-6';

export interface PrestartSpecTask {
  task: string;
  area: string | null;
  /** What the documents require, in a few plain sentences, or null. */
  requirements: string | null;
  citations: Array<{ document: string; revision: string | null; page: number | null }>;
  passages: Array<{ title: string; revision: string | null; page: number | null; snippet: string }>;
}

export interface PrestartSpecResult {
  documentsSearched: number;
  tasks: PrestartSpecTask[];
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  cached ??= new Anthropic();
  return cached;
}

const Tasks = z.object({
  tasks: z.array(z.object({ task: z.string(), area: z.string().nullable() })),
});

async function splitTasks(work: string): Promise<Array<{ task: string; area: string | null }>> {
  const response = await client().messages.parse({
    model: SPLIT_MODEL,
    max_tokens: 600,
    system: [{
      type: 'text',
      text: 'Split a construction supervisor\'s description of the day\'s work into the separate tasks it names. For each task give a short noun phrase of the work (e.g. "Spreading mulch", "Trenching for irrigation mainline") and the area or location if one is stated, else null. Keep the supervisor\'s own words for materials and places. Do not add tasks that are not stated. At most 8 tasks.',
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: work }],
    output_config: { format: zodOutputFormat(Tasks) },
  });
  return (response.parsed_output?.tasks ?? []).filter((t) => t.task.trim()).slice(0, 8);
}

type Row = { document_id: string; title: string; revision: string | null; page: number | null; chunk: string; snippet?: string };

async function passagesFor(supabase: SupabaseClient, projectId: string, task: { task: string; area: string | null }): Promise<Array<Row & { snippet: string }>> {
  const terms = searchTerms(`${task.task} ${task.area ?? ''}`);
  if (terms.length === 0) return [];
  const seen = new Map<string, Row & { snippet: string }>();
  const add = (rows: Row[]) => {
    for (const r of rows) {
      const k = `${r.document_id}:${r.page}:${r.chunk.slice(0, 40)}`;
      if (!seen.has(k)) seen.set(k, { ...r, snippet: r.snippet ?? r.chunk.slice(0, 240) });
    }
  };
  const { data: fts } = await supabase.rpc('document_search', { p_project_id: projectId, p_query: terms.join(' or '), p_limit: 8, p_plain: false });
  add((fts ?? []) as Row[]);
  if (seen.size < 6) {
    const { data: near } = await supabase.rpc('document_search_terms', { p_project_id: projectId, p_terms: terms, p_limit: 8 });
    add((near ?? []) as Row[]);
  }
  return [...seen.values()].slice(0, 8);
}

const Findings = z.object({
  tasks: z.array(z.object({
    n: z.number(),
    requirements: z.string().nullable(),
    citations: z.array(z.object({ document: z.string(), revision: z.string().nullable(), page: z.number().nullable() })),
  })),
});

const PROMPT = `You are briefing a construction crew at the morning prestart on what the job's own documents require for today's tasks — the specification, scope, contract, drawings, safety plan.
For each task you are given the passages a search returned. Those passages are the only thing you know about the documents.
For each task, write what the crew need to know to do it to spec: dimensions (depth, width, cover, thickness), materials and grades, standards, tolerances, spacing, compaction, hold points and inspections, and anything the documents say must happen before or after. Quote figures exactly. Three to six short sentences, or fewer if the documents say less.
Rules:
- Only from the passages for that task. Never add a figure, standard or practice from elsewhere, however standard it seems.
- If the passages state nothing that applies to a task, return null for it.
- Plain text, no markdown, no bullet symbols. Australian construction English, said the way a supervisor would read it out.
- Cite each figure: document title, revision and page from the passage it came from.`;

export async function prestartSpec(supabase: SupabaseClient, projectId: string, work: string): Promise<PrestartSpecResult> {
  const { count } = await supabase.from('project_documents').select('*', { count: 'exact', head: true }).eq('project_id', projectId).eq('status', 'ready');
  const documentsSearched = count ?? 0;
  const split = await splitTasks(work);
  if (documentsSearched === 0 || split.length === 0) {
    return { documentsSearched, tasks: split.map((t) => ({ ...t, requirements: null, citations: [], passages: [] })) };
  }
  const gathered = await Promise.all(split.map(async (t) => ({ ...t, passages: await passagesFor(supabase, projectId, t) })));
  const tasks: PrestartSpecTask[] = gathered.map((g) => ({
    task: g.task, area: g.area, requirements: null, citations: [],
    passages: g.passages.map((p) => ({ title: p.title, revision: p.revision, page: p.page, snippet: p.snippet })),
  }));
  const withPassages = gathered.map((g, i) => ({ g, i })).filter(({ g }) => g.passages.length > 0);
  if (withPassages.length === 0) return { documentsSearched, tasks };

  const input = withPassages.map(({ g, i }) => ({
    n: i,
    task: `${g.task}${g.area ? ` — ${g.area}` : ''}`,
    passages: g.passages.map((p, j) => ({ n: j + 1, document: p.title, revision: p.revision, page: p.page, text: p.chunk.slice(0, 1600) })),
  }));
  const response = await client().messages.parse({
    model: SPEC_MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(input, null, 1).slice(0, 90_000) }],
    output_config: { format: zodOutputFormat(Findings) },
  });
  for (const f of response.parsed_output?.tasks ?? []) {
    const target = tasks[f.n];
    if (!target) continue;
    target.requirements = f.requirements?.trim() || null;
    target.citations = target.requirements ? f.citations : [];
  }
  return { documentsSearched, tasks };
}
