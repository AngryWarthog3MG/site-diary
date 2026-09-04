'use client';

import { useState } from 'react';

/**
 * Send the signed docket to anyone — the PM's inbox, the contract
 * administrator, the client. The PDF attached is the stored export, so every
 * recipient of this entry ever receives the identical document.
 */
export function EmailPdfButton({
  entryId,
  doc = 'daily',
  heading = 'Email the PDF',
  placeholder = 'pm@example.com — up to 5, comma-separated',
}: {
  entryId: string;
  doc?: 'daily' | 'dayworks';
  heading?: string;
  placeholder?: string;
}) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, doc }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json?.error?.message ?? 'The email was not sent.');
        return;
      }
      setNotice(`Sent to ${(json.sent as string[]).join(', ')}.`);
      setTo('');
    } catch {
      setError('No signal — try again when you are back in range.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="email-pdf">
      <p className="label">{heading}</p>
      <div className="email-pdf__row">
        <input
          className="field field--sm"
          type="text"
          inputMode="email"
          placeholder={placeholder}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <button
          className="button button--quiet"
          type="button"
          disabled={busy || !to.trim()}
          onClick={send}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {notice && <p className="email-pdf__ok">{notice}</p>}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}
