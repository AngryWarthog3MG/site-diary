'use client';

import { useState } from 'react';

/**
 * The claim skeleton, drafted on demand from the register — clearly a DRAFT
 * for a person to review, never stored, every figure gated against the
 * register before it reaches the screen.
 */
export function DraftClaimButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/claims/narrative?project=${projectId}`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? 'The draft could not be generated.');
        return;
      }
      setDraft(json.draft as string);
    } catch {
      setError('No signal — try again when you are back in range.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Selection fallback is the browser's own.
    }
  }

  return (
    <>
      <button className="button button--quiet" type="button" onClick={generate} disabled={busy}>
        {busy ? 'Drafting…' : 'Draft claim narrative'}
      </button>
      {error && <p className="alert">{error}</p>}
      {draft && (
        <section className="claim-draft">
          <div className="claim-draft__head">
            <p className="label">Draft — AI-prepared from the register. Review before issuing.</p>
            <button className="quotebtn" type="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy text'}
            </button>
          </div>
          <pre className="claim-draft__body">{draft}</pre>
        </section>
      )}
    </>
  );
}
