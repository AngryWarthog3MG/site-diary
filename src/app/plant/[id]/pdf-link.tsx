'use client';

import { useState } from 'react';

export function PdfLink({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function get() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/plant/${id}/pdf`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) { setError(json?.error?.message ?? 'The PDF could not be generated.'); return; }
      window.open(json.url as string, '_blank', 'noopener');
    } catch { setError('No signal — try again when you are back in range.'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button className="button" type="button" disabled={busy} onClick={get}>{busy ? 'Making the PDF…' : 'Get the PDF'}</button>
      {error && <p className="alert">{error}</p>}
    </>
  );
}
