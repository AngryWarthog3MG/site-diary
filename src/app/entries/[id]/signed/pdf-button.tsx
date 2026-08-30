'use client';

import { useState } from 'react';

/**
 * Generate the daily PDF and hand over the link.
 *
 * The document is byte-identical on every render, so the server reuses a
 * stored copy rather than launching Chromium again — which is why this can be
 * pressed as often as anyone likes.
 */
export function PdfButton({ entryId }: { entryId: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setState('working');
    setError(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/pdf`, { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json?.error?.message ?? 'The PDF could not be generated.');
        setState('idle');
        return;
      }
      setUrl(json.url as string);
      setState('ready');
    } catch {
      setError('No signal. Try again when you are back in range.');
      setState('idle');
    }
  }

  if (state === 'ready' && url) {
    return (
      <>
        <a className="button" href={url} target="_blank" rel="noreferrer">
          Open the PDF
        </a>
        <p style={{ marginTop: '0.5rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
          The link works for an hour. Generate it again for a fresh one.
        </p>
      </>
    );
  }

  return (
    <>
      <button className="button" type="button" onClick={generate} disabled={state === 'working'}>
        {state === 'working' ? 'Generating…' : 'Generate the daily PDF'}
      </button>
      {error && <p className="alert">{error}</p>}
    </>
  );
}
