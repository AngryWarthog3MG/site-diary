'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SpecNote } from '@/lib/prestart/spec-notes';

/**
 * What the specification requires for today's work, pulled from the job's
 * documents and kept on the prestart. The supervisor says what is on, pulls,
 * and keeps the tasks that apply; each requirement is cited so the crew are
 * briefed from the document, not from memory.
 */

export type { SpecNote } from '@/lib/prestart/spec-notes';

interface Pulled {
  task: string;
  area: string | null;
  requirements: string | null;
  citations: SpecNote['citations'];
  passages: Array<{ title: string; revision: string | null; page: number | null; snippet: string }>;
}

const cite = (c: SpecNote['citations']) =>
  c.map((x) => `${x.document}${x.revision ? ` rev ${x.revision}` : ''}${x.page != null ? ` p. ${x.page}` : ''}`).join(' · ');

export function PrestartSpecPicker({
  projectId,
  work,
  notes,
  readOnly,
  onKeep,
}: {
  projectId: string;
  /** The "what is on today" text as it stands now. */
  work: string;
  /** What is kept on the prestart. */
  notes: SpecNote[];
  readOnly: boolean;
  onKeep: (notes: SpecNote[]) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulled, setPulled] = useState<{ documentsSearched: number; tasks: Pulled[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());

  async function pull() {
    if (!work.trim()) { setError('Say what is on today first.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/prestart/spec-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, work }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? 'The spec lookup failed.');
      const result = json as { documentsSearched: number; tasks: Pulled[] };
      setPulled(result);
      setPicked(new Set(result.tasks.map((t, i) => (t.requirements ? i : -1)).filter((i) => i >= 0)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No signal — try again when you are back in range.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!pulled) return;
    const kept: SpecNote[] = pulled.tasks
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => picked.has(i) && t.requirements)
      .map(({ t }) => ({ task: t.task, area: t.area, requirements: t.requirements as string, citations: t.citations }));
    setBusy(true);
    setError(null);
    try {
      await onKeep(kept);
      setPulled(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="specpick">
      <div className="review-section-head">
        <div>
          <p className="label">From the specification</p>
          <h2 className="home-card__title">{notes.length === 0 ? 'Nothing pulled yet' : `${notes.length} task${notes.length === 1 ? '' : 's'} briefed to spec`}</h2>
        </div>
        {!readOnly && !pulled && (
          <button className="button button--quiet review-add" type="button" disabled={busy || !work.trim()} onClick={pull}>
            {busy ? 'Reading…' : notes.length ? 'Pull again' : 'Pull from the specs'}
          </button>
        )}
      </div>
      {!readOnly && !pulled && notes.length === 0 && (
        <p className="review-muted">
          Say what is on today above, then pull: each task comes back with the depths, widths, materials,
          standards and hold points the documents require, cited. Keep the ones that apply and the crew are
          briefed straight from the spec.
        </p>
      )}

      {notes.length > 0 && !pulled && (
        <ul className="specnotes">
          {notes.map((n, i) => (
            <li key={i} className="specnote">
              <p className="specnote__task">{n.task}{n.area ? <span className="vr-note" style={{ display: 'inline' }}> · {n.area}</span> : null}</p>
              <p className="specnote__req">{n.requirements}</p>
              {n.citations.length > 0 && <p className="specnote__cite mono">{cite(n.citations)}</p>}
            </li>
          ))}
        </ul>
      )}

      {pulled && (
        <>
          {pulled.documentsSearched === 0 && (
            <p className="notice gap">
              No documents on this job yet. <Link href={`/documents?project=${projectId}`}>Upload the spec</Link> first.
            </p>
          )}
          <ul className="specnotes">
            {pulled.tasks.map((t, i) => (
              <li key={i} className={`specnote${t.requirements ? '' : ' specnote--none'}`}>
                <label className="specnote__pick">
                  <input type="checkbox" disabled={!t.requirements} checked={picked.has(i)}
                    onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                  <span className="specnote__task">{t.task}{t.area ? <span className="vr-note" style={{ display: 'inline' }}> · {t.area}</span> : null}</span>
                </label>
                <p className="specnote__req">{t.requirements ?? <span className="review-muted">The documents say nothing that applies to this task.</span>}</p>
                {t.citations.length > 0 && <p className="specnote__cite mono">{cite(t.citations)}</p>}
                {t.passages.length > 0 && (
                  <>
                    <button className="quotebtn" type="button" onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                      {open.has(i) ? 'Hide the passages' : `Show the ${t.passages.length} passage${t.passages.length === 1 ? '' : 's'} it read`}
                    </button>
                    {open.has(i) && t.passages.map((p, j) => (
                      <blockquote key={j} className="spec-line__passage">
                        <p className="mono" style={{ margin: 0, fontSize: '0.75rem' }}>{p.title}{p.revision ? ` rev ${p.revision}` : ''}{p.page != null ? ` · p. ${p.page}` : ''}</p>
                        <p style={{ margin: '0.2rem 0 0' }}>{p.snippet.replace(/<<|>>/g, '')}</p>
                      </blockquote>
                    ))}
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="photo-add-pair">
            <button className="button" type="button" disabled={busy} onClick={keep}>
              {busy ? 'Saving…' : picked.size === 0 ? 'Keep none' : `Keep ${picked.size} on the prestart`}
            </button>
            <button className="button button--quiet" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={() => setPulled(null)}>
              Cancel
            </button>
          </div>
          <p className="way-hint">Searched {pulled.documentsSearched} document{pulled.documentsSearched === 1 ? '' : 's'}. Kept tasks go on the prestart and its PDF, cited.</p>
        </>
      )}
      {error && <p className="alert">{error}</p>}
    </section>
  );
}
