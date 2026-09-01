import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DIARY_SCHEMA_DOC, SQL_RULES, QUERY_SCHEMA_VERSION } from './schema-doc.ts';
import { validateGeneratedSql } from './validate.ts';

/**
 * The query layer (brief §5).
 *
 * Two paths, chosen by a lightweight classifier, exactly as the brief lays
 * out. No agent loop, no framework, no retry: a classification call, then
 * either SQL generation or full-text search, then one call to phrase the rows.
 *
 * The rule that shapes all of it: **neither path may answer from the model's
 * own knowledge**. That is enforced structurally rather than asked for — when
 * a query returns no rows the model is never called at all, and the answer is
 * a fixed sentence. A model that is not invoked cannot invent anything.
 */

export const QUERY_MODEL = process.env.ANTHROPIC_QUERY_MODEL ?? 'claude-sonnet-4-6';
export const CLASSIFIER_MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL ?? 'claude-haiku-4-5';

export type QueryPath = 'structured' | 'semantic';

export interface SearchHit {
  entry_no: string;
  entry_date: string;
  project_name: string;
  field: string;
  snippet: string;
}

export interface Citation {
  entry_no: string;
  entry_id: string;
}

export interface AskResult {
  question: string;
  path: QueryPath;
  answer: string;
  /** The SQL that produced the table, shown to the user on the structured path. */
  sql: string | null;
  rows: Record<string, unknown>[];
  hits: SearchHit[];
  /** §5: every answer cites entry numbers, and each one links back to its entry. */
  citations: Citation[];
  rowCount: number;
  schemaVersion: string;
}

export class AskError extends Error {
  readonly sql: string | null;
  constructor(message: string, sql: string | null = null) {
    super(message);
    this.name = 'AskError';
    this.sql = sql;
  }
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new AskError('ANTHROPIC_API_KEY is not set.');
  cached ??= new Anthropic();
  return cached;
}

const Classification = z.object({
  path: z.enum(['structured', 'semantic']),
  reason: z.string(),
  /**
   * The content words worth searching for, question scaffolding stripped.
   * Full-text search ANDs its terms, so "what happened with the Telstra
   * crossing" finds nothing — no entry contains "happened". "Telstra
   * crossing" finds the record.
   */
  search_terms: z.string(),
});

const GeneratedSql = z.object({
  sql: z.string(),
  /** What the query is meant to return, so a wrong answer is diagnosable. */
  intent: z.string(),
});

const CLASSIFIER_PROMPT = `You are routing a question about a construction site diary to one of two ways of answering it.

**structured** — the question is about numbers, dates, totals, counts or anything that can be got by querying columns. "How many rain days last month", "total labour hours in July", "when did we pour and what volumes", "which variations are still without a VR reference".

**semantic** — the question is about what someone said or described, and needs the supervisor's own words. "What did Lendlease say about the sub-meters", "any issues with access to Area B", "what happened with the retaining wall".

If a question could be either, prefer **structured**: a table of rows with entry numbers is more use to a project manager than a quotation, and the structured path shows its working.

Also return search_terms: just the content words someone would grep the diary for, with the question scaffolding stripped. "What happened with the Telstra crossing?" -> "Telstra crossing". "Any issues with access to Area B?" -> "access Area B".`;

async function classify(
  question: string,
): Promise<{ path: QueryPath; searchTerms: string | null }> {
  try {
    const response = await client().messages.parse({
      model: CLASSIFIER_MODEL,
      max_tokens: 256,
      system: [{ type: 'text', text: CLASSIFIER_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: question }],
      output_config: { format: zodOutputFormat(Classification) },
    });
    return {
      path: response.parsed_output?.path ?? 'structured',
      searchTerms: response.parsed_output?.search_terms?.trim() || null,
    };
  } catch {
    // The classifier is an optimisation, not a gate. If it fails, take the
    // path that shows its working.
    return { path: 'structured', searchTerms: null };
  }
}

async function generateSql(
  question: string,
  scope: { projectId: string | null; projectName: string | null },
  repair?: { sql: string; error: string },
): Promise<string> {
  const scopeLine = scope.projectId
    ? `Project in scope: ${scope.projectName ?? 'unnamed'} (project_id '${scope.projectId}').\n` +
      `Every diary view you read MUST be filtered with project_id = '${scope.projectId}' — ` +
      `the person is asking about this project only.\n\n`
    : '';
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `${scopeLine}Question: ${question}`,
    },
  ];
  if (repair) {
    messages.push({
      role: 'user',
      content:
        `The query you wrote failed.\n\nSQL:\n${repair.sql}\n\nError: ${repair.error}\n\n` +
        `Write a corrected query for the same question. Fix only what the error names.`,
    });
  }

  const response = await client().messages.parse({
    model: QUERY_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: `You write PostgreSQL for a construction site diary.\n\n${SQL_RULES}\n\n# Schema\n\n${DIARY_SCHEMA_DOC}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
    output_config: { effort: 'medium', format: zodOutputFormat(GeneratedSql) },
  });

  const sql = response.parsed_output?.sql;
  if (!sql) throw new AskError('No query could be written for that question.');
  return sql;
}

const ANSWER_PROMPT = `You are answering a project manager's question about a construction site diary.

You are given the question and the rows that answering it returned. Those rows are the only thing you know.

- Answer **only** from the rows. Never add a fact, a figure, a cause or a piece of context that is not in them, however obvious it seems.
- Cite entry numbers in the prose, like KBL-C001-042, wherever a figure comes from a particular entry.
- If the rows do not actually answer what was asked, say what they do show and what is missing. Do not fill the gap.
- Be brief. The table is shown underneath your answer, so do not read it out row by row — say what it means.
- Do not speculate about why. The diary records what happened, not why, unless a supervisor said so.
- Australian construction English. Plain, direct, no throat-clearing.`;

async function phrase(
  question: string,
  path: QueryPath,
  payload: unknown,
): Promise<string> {
  const response = await client().messages.create({
    model: QUERY_MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: ANSWER_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          `Question: ${question}`,
          '',
          path === 'structured'
            ? 'Rows returned by the query:'
            : 'Matching entries, with the relevant line quoted (<< >> marks the match):',
          '```json',
          JSON.stringify(payload, null, 1).slice(0, 60_000),
          '```',
        ].join('\n'),
      },
    ],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function entryNumbersIn(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row.entry_no;
    if (typeof value === 'string' && value) seen.add(value);
  }
  return [...seen].sort();
}

/**
 * Turn the entry numbers an answer cites into links.
 *
 * §5 asks for entry numbers that link back to the source entries — a citation
 * a PM cannot follow is not much of a citation. Resolved under the caller's
 * own RLS, so a number they cannot open simply does not become a link.
 */
async function resolveCitations(
  supabase: SupabaseClient,
  entryNumbers: string[],
): Promise<Citation[]> {
  if (entryNumbers.length === 0) return [];

  const { data } = await supabase
    .from('entries')
    .select('id, entry_no')
    .in('entry_no', entryNumbers);

  const byNumber = new Map(
    ((data ?? []) as Array<{ id: string; entry_no: string }>).map((row) => [row.entry_no, row.id]),
  );

  return entryNumbers
    .map((entry_no) => ({ entry_no, entry_id: byNumber.get(entry_no) ?? '' }))
    .filter((citation) => citation.entry_id !== '');
}

const NOTHING_FOUND =
  'No records found. Nothing in the signed diary for this project matches that question.';

export async function ask(
  supabase: SupabaseClient,
  question: string,
  options: { projectId?: string | null; projectName?: string | null } = {},
): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new AskError('Ask a question first.');

  const base = {
    question: trimmed,
    schemaVersion: QUERY_SCHEMA_VERSION,
    sql: null as string | null,
    rows: [] as Record<string, unknown>[],
    hits: [] as SearchHit[],
  };

  const { path, searchTerms } = await classify(trimmed);

  if (path === 'semantic') {
    const { data, error } = await supabase.rpc('diary_search', {
      p_query: searchTerms ?? trimmed,
      p_project_id: options.projectId ?? null,
      p_limit: 20,
    });
    if (error) throw new AskError(`Search failed: ${error.message}`);

    const hits = (data ?? []) as SearchHit[];
    if (hits.length === 0) {
      return { ...base, path, answer: NOTHING_FOUND, citations: [], rowCount: 0 };
    }

    const numbers = entryNumbersIn(hits as unknown as Record<string, unknown>[]);
    const [answer, citations] = await Promise.all([
      phrase(trimmed, path, hits),
      resolveCitations(supabase, numbers),
    ]);

    return { ...base, path, hits, answer, citations, rowCount: hits.length };
  }

  // One write, and one bounded repair if that write fails — the generator is
  // shown its own SQL and the exact error, once. Not a loop: a second failure
  // is handed back with the SQL attached so the person can see what was
  // attempted and rephrase. §2's "no branching" bars agentic wandering, not a
  // fixed two-attempt sequence.
  type Attempt =
    | { ok: true; sql: string; rows: Record<string, unknown>[] }
    | { ok: false; sql: string; error: string };

  const attempt = async (repair?: { sql: string; error: string }): Promise<Attempt> => {
    const generated = await generateSql(
      trimmed,
      { projectId: options.projectId ?? null, projectName: options.projectName ?? null },
      repair,
    );
    const check = validateGeneratedSql(generated);
    if (!check.ok) {
      return { ok: false, sql: check.sql ?? generated, error: check.reason ?? 'invalid SQL' };
    }
    // A project-scoped question must produce project-scoped SQL. The check is
    // blunt — the uuid must appear in the query — and a miss goes back through
    // the repair pass rather than out to the database: RLS keeps the data to
    // the caller's projects, but only this keeps it to the project they asked
    // about. (A signed Test Site entry once padded a Curtin labour total.)
    if (options.projectId && !check.sql.includes(options.projectId)) {
      return {
        ok: false,
        sql: check.sql,
        error: `The query must filter every diary view with project_id = '${options.projectId}'.`,
      };
    }
    const { data, error } = await supabase.rpc(
      'run_diary_query',
      { p_sql: check.sql, p_limit: 200 },
      { get: true },
    );
    if (error) return { ok: false, sql: check.sql, error: error.message };
    const result = data as { rows?: Record<string, unknown>[]; row_count?: number } | null;
    return { ok: true, sql: check.sql, rows: result?.rows ?? [] };
  };

  let outcome = await attempt();
  if (!outcome.ok) {
    outcome = await attempt({ sql: outcome.sql, error: outcome.error });
  }
  if (!outcome.ok) {
    throw new AskError(`That query did not run: ${outcome.error}`, outcome.sql);
  }

  const rows = outcome.rows;

  if (rows.length === 0) {
    // The model is never called on an empty result. §5 forbids answering from
    // the model's own knowledge, and the surest way to guarantee that is not
    // to ask it.
    return { ...base, path, sql: outcome.sql, answer: NOTHING_FOUND, citations: [], rowCount: 0 };
  }

  const [answer, citations] = await Promise.all([
    phrase(trimmed, path, rows),
    resolveCitations(supabase, entryNumbersIn(rows)),
  ]);

  return { ...base, path, sql: outcome.sql, rows, answer, citations, rowCount: rows.length };
}
