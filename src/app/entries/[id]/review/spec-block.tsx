'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * The Spec tab: for every line on the review — each work item, pour and
 * variation — what the job's documents require for it, cited. Read beside
 * what the supervisor is confirming; never written into the record. Runs
 * when the tab opens and again on request, against the lines as they are now.
 */

export interface SpecLine {
  key: string;
  group: 'work_items' | 'pours' | 'variations';
  text: string;
  area: string | null;
}

interface Finding {
  key: string;
  spec: string | null;
  citations: Array<{ document: string; revision: string | null; page: number | null }>;
  passages: Array<{ title: string; revision: string | null; page: number | null; snippet: string }>;
}

export function SpecBlock({ entryId, projectId, lines }: { entryId: string; projectId: string; lines: SpecLine[] }) {
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<{ documentsSearched: number; findings: Finding[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const checkedFor = useRef<string>('');
  const signature = JSON.stringify(lines);

  async function check() {
    if (lines.length === 0) return;
    setState('checking');
    setError(null);
    try {
      const res = await fetch(`/api/entries/${entryId}/spec-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: lines }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? 'The spec check failed.');
      setResult(json as { documentsSearched: number; findings: Finding[] });
      checkedFor.current = signature;
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No signal — try again when you are back in range.');
      setState('failed');
    }
  }

  useEffect(() => {
    if (state === 'idle' && lines.length > 0) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = state === 'done' && checkedFor.current !== signature;
  const byKey = new Map((result?.findings ?? []).map((f) => [f.key, f]));
  const groupLabel = { work_items: 'Work', pours: 'Pour', variations: 'Variation' } as const;

  return (
    <section>
      <div className="review-section-head">
        <div>
          <p className="label">Against the job documents</p>
          <h2>Spec</h2>
        </div>
        {lines.length > 0 && (
          <button className="button button--quiet review-add" type="button" disabled={state === 'checking'} onClick={check}>
            {state === 'checking' ? 'Checking…' : stale ? 'Check again' : 'Re-check'}
          </button>
        )}
      </div>
      <p className="review-muted">
        What the spec, scope and drawings require for each line below, cited. For checking only —
        nothing on this tab goes into the diary; what you confirm on the other tabs is the record.
      </p>

      {lines.length === 0 && (
        <p className="claims-nil">Nothing to check yet. Add works, a pour or a variation and this tab looks them up.</p>
      )}
      {error && <p className="alert">{error}</p>}
      {stale && <p className="notice gap">The lines have changed since this check. Check again.</p>}
      {result && result.documentsSearched === 0 && (
        <p className="notice gap">
          No documents on this job yet.{' '}
          <Link href={`/documents?project=${projectId}`}>Upload the spec</Link> and this tab will read it.
        </p>
      )}

      {lines.map((line) => {
        const f = byKey.get(line.key);
        const isOpen = open.has(line.key);
        return (
          <article key={line.key} className={`item spec-line${f?.spec ? ' spec-line--found' : ''}`}>
            <p className="spec-line__diary">
              <span className="label">{groupLabel[line.group]}</span>
              {line.text}{line.area ? <span className="vr-note" style={{ display: 'inline' }}> · {line.area}</span> : null}
            </p>
            {state === 'checking' && !f && <p className="review-muted">Looking it up…</p>}
            {f && (
              <>
                <p className="spec-line__spec">
                  <span className="label">Spec says</span>
                  {f.spec ?? <span className="review-muted">Nothing in the documents applies to this line.</span>}
                </p>
                {f.citations.length > 0 && (
                  <p className="spec-line__cite mono">
                    {f.citations.map((c, i) => `${i > 0 ? ' · ' : ''}${c.document}${c.revision ? ` rev ${c.revision}` : ''}${c.page != null ? ` p. ${c.page}` : ''}`)}
                  </p>
                )}
                {f.passages.length > 0 && (
                  <>
                    <button className="quotebtn" type="button" onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(line.key)) n.delete(line.key); else n.add(line.key); return n; })}>
                      {isOpen ? 'Hide the passages' : `Show the ${f.passages.length} passage${f.passages.length === 1 ? '' : 's'} it read`}
                    </button>
                    {isOpen && f.passages.map((p, i) => (
                      <blockquote key={i} className="spec-line__passage">
                        <p className="mono" style={{ margin: 0, fontSize: '0.75rem' }}>{p.title}{p.revision ? ` rev ${p.revision}` : ''}{p.page != null ? ` · p. ${p.page}` : ''}</p>
                        <p style={{ margin: '0.2rem 0 0' }}>{p.snippet.replace(/<<|>>/g, '')}</p>
                      </blockquote>
                    ))}
                  </>
                )}
              </>
            )}
          </article>
        );
      })}
      {result && result.documentsSearched > 0 && (
        <p className="way-hint">Searched {result.documentsSearched} document{result.documentsSearched === 1 ? '' : 's'} on this job.</p>
      )}
    </section>
  );
}
