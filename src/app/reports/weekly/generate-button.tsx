'use client';

import { useState } from 'react';

/**
 * Shared generate-and-open flow for the report POST routes: call, wait,
 * open the shareable link, or show why not.
 */
function useGenerate(url: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as {
        url?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.url) {
        setError(body?.error?.message ?? 'The report could not be generated.');
        return;
      }
      window.open(body.url, '_blank', 'noopener');
    } catch {
      setError('No signal — try again when you are back in range.');
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, generate };
}

/** "2026-08-24" → "Aug 2026" for the button label. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MonthlyBundleButton({ projectId, start }: { projectId: string; start: string }) {
  const month = start.slice(0, 7);
  const label = `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  const { busy, error, generate } = useGenerate(
    `/api/reports/monthly?project=${projectId}&month=${month}`,
  );
  return (
    <>
      <button className="button button--outline" type="button" onClick={generate} disabled={busy}>
        {busy ? 'Bundling the month…' : `Month bundle (${label})`}
      </button>
      {error && <p className="weekly-error">{error}</p>}
    </>
  );
}

/**
 * One button: generate the weekly PDF (with its commentary) and open the
 * shareable link. Generation takes a while — Chromium plus a model call — so
 * the button says so instead of appearing hung.
 */
export function GenerateWeeklyPdf({
  projectId,
  start,
  end,
}: {
  projectId: string;
  start: string;
  end: string;
}) {
  const { busy, error, generate } = useGenerate(
    `/api/reports/weekly?project=${projectId}&start=${start}&end=${end}`,
  );

  return (
    <>
      <button className="button" type="button" onClick={generate} disabled={busy}>
        {busy ? 'Generating — about a minute…' : 'Generate weekly PDF'}
      </button>
      {error && <p className="weekly-error">{error}</p>}
    </>
  );
}
