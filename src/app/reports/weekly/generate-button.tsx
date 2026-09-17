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

interface BundlePart { part: number; of: number; url: string | null; bytes: number; from: string; to: string; entries: number; ready: boolean }

const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

/**
 * The month bundle. A busy month is bound in parts, each built by its own
 * request (README R71): ask for the plan, then build the parts not yet stored,
 * one after another, showing a link for each as it lands.
 */
export function MonthlyBundleButton({ projectId, start }: { projectId: string; start: string }) {
  const month = start.slice(0, 7);
  const label = `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState<BundlePart[] | null>(null);
  const base = `/api/reports/monthly?project=${projectId}&month=${month}`;

  const call = async (url: string) => {
    const res = await fetch(url, { method: 'POST' });
    const body = (await res.json().catch(() => null)) as (BundlePart & { parts?: BundlePart[]; error?: { message?: string } }) | null;
    if (!res.ok || !body) throw new Error(body?.error?.message ?? 'The bundle could not be made.');
    return body;
  };

  const generate = async () => {
    setBusy('Working out the parts…');
    setError(null);
    setParts(null);
    try {
      const plan = await call(base);
      let list = plan.parts ?? [];
      setParts(list);
      for (const p of list) {
        if (p.ready) continue;
        setBusy(list.length > 1 ? `Building part ${p.part} of ${p.of} — up to two minutes each…` : 'Building the bundle…');
        const built = await call(`${base}&part=${p.part}`);
        list = list.map((x) => (x.part === built.part ? built : x));
        setParts(list);
      }
      if (list.length === 1 && list[0].url) window.open(list[0].url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof TypeError ? 'No signal — try again when you are back in range. Parts already built are kept.' : err instanceof Error ? err.message : 'The bundle could not be made.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button className="button button--outline" type="button" onClick={generate} disabled={busy !== null}>
        {busy ?? `Month bundle (${label})`}
      </button>
      {error && <p className="weekly-error">{error}</p>}
      {parts && (
        <div className="bundle-parts">
          {parts.length > 1 && (
            <p className="caption">This month is too big for one file, so it is in {parts.length} parts. Each part lists the whole month on its first page.</p>
          )}
          {parts.map((p) => {
            const text = `${parts.length > 1 ? `Part ${p.part} of ${p.of}: ` : 'Open the bundle: '}${p.from === p.to ? dm(p.from) : `${dm(p.from)} to ${dm(p.to)}`} · ${p.entries} ${p.entries === 1 ? 'docket' : 'dockets'} · ${mb(p.bytes)}`;
            return p.ready && p.url ? (
              <a key={p.part} className="button button--quiet" href={p.url} target="_blank" rel="noopener">{text}</a>
            ) : (
              <span key={p.part} className="button button--quiet" aria-disabled="true" style={{ opacity: 0.55 }}>{text} · not built yet</span>
            );
          })}
        </div>
      )}
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
      <button className="button button--outline" type="button" onClick={generate} disabled={busy}>
        {busy ? 'Generating — about a minute…' : 'Client report (PDF with commentary)'}
      </button>
      {error && <p className="weekly-error">{error}</p>}
    </>
  );
}
