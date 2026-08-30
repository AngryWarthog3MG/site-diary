'use client';

import { useState } from 'react';
import Link from 'next/link';

interface AskResponse {
  question: string;
  path: 'structured' | 'semantic';
  answer: string;
  sql: string | null;
  rows: Record<string, unknown>[];
  hits: Array<{
    entry_no: string;
    entry_date: string;
    project_name: string;
    field: string;
    snippet: string;
  }>;
  citations: Array<{ entry_no: string; entry_id: string }>;
  rowCount: number;
}

const EXAMPLES = [
  'Total labour hours in August',
  'When did we pour concrete and what volumes',
  'How many rain days this month',
  'Any variations still without a VR reference',
  'Any issues with access to Area B',
];

/**
 * Screen 5 (brief §7.5).
 *
 * The table is always shown alongside the prose, and every entry number is a
 * link back to the entry it came from — §5 is explicit that an answer has to
 * show its working. On the structured path the SQL is there too, folded away:
 * a PM who wants to check the arithmetic can, and one who does not never sees
 * it.
 */
export function AskScreen({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedSql, setFailedSql] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  async function submit(text: string) {
    const asked = text.trim();
    if (!asked || busy) return;

    setBusy(true);
    setError(null);
    setFailedSql(null);
    setResult(null);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: asked, projectId }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(json?.error?.message ?? 'That question could not be answered.');
        setFailedSql(json?.error?.sql ?? null);
        return;
      }
      setResult(json as AskResponse);
    } catch {
      setError('No signal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sheet sheet--wide">
      <p className="label">{projectName}</p>
      <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.375rem', fontWeight: 600 }}>Ask</h1>
      <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
        Questions are answered from signed entries only, and every answer shows the rows it came
        from.
      </p>

      <form
        style={{ marginTop: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <label className="label" htmlFor="question">
          Question
        </label>
        <textarea
          id="question"
          className="field field--sm"
          rows={2}
          value={question}
          placeholder="Total labour hours in August"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="button" type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Looking…' : 'Ask'}
        </button>
      </form>

      {!result && !busy && (
        <>
          <p className="label" style={{ marginTop: '1.5rem' }}>
            For example
          </p>
          <ul className="examples">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className="quotebtn"
                  onClick={() => {
                    setQuestion(example);
                    void submit(example);
                  }}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && (
        <>
          <p className="alert">{error}</p>
          {failedSql && <pre className="sql">{failedSql}</pre>}
        </>
      )}

      {result && (
        <section style={{ marginTop: '1.5rem' }}>
          <hr className="rule" />
          <p className="label">
            Answer · {result.path === 'structured' ? 'from the record' : 'from what was said'}
          </p>
          <div className="answer">
            {result.answer.split(/\n{2,}/).map((para, index) => (
              <p key={index}>{para}</p>
            ))}
          </div>

          {result.citations.length > 0 && (
            <>
              <p className="label" style={{ marginTop: '1rem' }}>
                Entries cited · tap to open
              </p>
              <ul className="chips">
                {result.citations.map((citation) => (
                  <li key={citation.entry_no}>
                    <Link
                      className="chip chip--on chip--link mono"
                      href={`/entries/${citation.entry_id}/signed`}
                    >
                      {citation.entry_no}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.rows.length > 0 && <RowTable rows={result.rows} />}

          {result.hits.length > 0 && (
            <>
              <hr className="rule" />
              <p className="label">Matching entries · {result.hits.length}</p>
              {result.hits.map((hit, index) => (
                <article key={index} className="item">
                  <p className="mono" style={{ margin: 0, fontSize: '0.875rem' }}>
                    {hit.entry_no} · {hit.entry_date} · {hit.field}
                  </p>
                  <Snippet text={hit.snippet} />
                </article>
              ))}
            </>
          )}

          {result.sql && (
            <>
              <hr className="rule" />
              <button type="button" className="quotebtn" onClick={() => setShowSql((v) => !v)}>
                {showSql ? 'Hide the query' : 'Show the query'}
              </button>
              {showSql && <pre className="sql">{result.sql}</pre>}
            </>
          )}
        </section>
      )}

      <hr className="rule" />
      <Link className="button button--quiet" href="/">
        Back to today
      </Link>
    </main>
  );
}

function RowTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return (
    <>
      <p className="label" style={{ marginTop: '1rem' }}>
        Rows · {rows.length}
      </p>
      <div className="tablewrap">
        <table className="rows">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column.replace(/_/g, ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} className="mono">
                    {format(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function format(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The search snippet marks matches with << >>; render them rather than print them. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(<<[^>]*>>)/g);
  return (
    <p style={{ margin: '0.375rem 0 0', fontSize: '0.9375rem', lineHeight: 1.5 }}>
      {parts.map((part, index) =>
        part.startsWith('<<') && part.endsWith('>>') ? (
          <mark key={index}>{part.slice(2, -2)}</mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}
