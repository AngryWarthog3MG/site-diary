'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The only door into changing a signed day: a correction. One tap opens a
 * superseding draft pre-filled with everything this entry recorded, so the
 * person only adds what was missed. The signed entry itself is never touched
 * — the record shows both, and who made the correction.
 */
export function CorrectButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function correct() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/correct`, { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Already corrected by a signed entry — go correct that one.
        const redirect = json?.error?.extra?.entryId ?? json?.entryId;
        if (response.status === 409 && redirect) {
          router.push(`/entries/${redirect}/signed`);
          return;
        }
        setError(json?.error?.message ?? 'Could not open a correction.');
        return;
      }
      router.push(`/entries/${json.entryId}/review`);
    } catch {
      setError('No signal — try again when you are back in range.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="button button--quiet" type="button" onClick={correct} disabled={busy}>
        {busy ? 'Opening the correction…' : 'Correct this entry'}
      </button>
      <p style={{ margin: '0.375rem 0 0', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
        Opens a new entry pre-filled from this one. This entry stays on the record, marked
        as superseded — signed entries are never edited, corrections replace them.
      </p>
      {error && <p className="alert">{error}</p>}
    </>
  );
}
