'use client';

import { useState } from 'react';

/**
 * Generate the daily PDF and hand over the link.
 *
 * The document is byte-identical on every render, so the server reuses a
 * stored copy rather than launching Chromium again — which is why this can be
 * pressed as often as anyone likes.
 */
export function PdfButton({
  entryId,
  entryNo,
  endpoint = 'pdf',
  label = 'Generate the daily PDF',
  shareTitle,
}: {
  entryId: string;
  entryNo?: string | null;
  /** 'pdf' for the daily docket, 'client-sheet' for the client's dayworks and variations. */
  endpoint?: 'pdf' | 'client-sheet';
  label?: string;
  shareTitle?: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<null | 'shared' | 'copied'>(null);

  /**
   * Hand the PDF link to whatever the phone shares with — on site that means
   * straight into the WhatsApp thread with the PM. Falls back to copying the
   * link where the share sheet does not exist (desktop browsers).
   */
  async function share() {
    if (!url) return;
    const title = shareTitle ?? (entryNo ? `Site diary ${entryNo}` : 'Site diary PDF');
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setShared('shared');
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared('copied');
    } catch {
      // A dismissed share sheet is not an error worth reporting.
    }
  }

  async function generate() {
    setState('working');
    setError(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/${endpoint}`, { method: 'POST' });
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
        <button
          className="button button--quiet"
          type="button"
          onClick={share}
          style={{ marginTop: '0.5rem' }}
        >
          {shared === 'copied' ? 'Link copied' : shared === 'shared' ? 'Shared' : 'Share the PDF'}
        </button>
        <p style={{ marginTop: '0.5rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
          The link works for an hour. Generate it again for a fresh one.
        </p>
      </>
    );
  }

  return (
    <>
      <button className="button" type="button" onClick={generate} disabled={state === 'working'}>
        {state === 'working' ? 'Generating…' : label}
      </button>
      {error && <p className="alert">{error}</p>}
    </>
  );
}
