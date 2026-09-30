'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Cell } from '@/lib/registers/model';

/** One save at a time, its failure said plainly, the page reloaded from the record when it lands. */
export function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<string | void>): Promise<boolean> {
    if (busy) return false;
    setBusy(key); setError(null); setNotice(null);
    try {
      const said = await fn();
      setNotice(said || 'Saved.');
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, notice, run, setError };
}

/** A verdict from the register's own rules, in the screen's colours. */
export function Verdict({ label, cell }: { label: string; cell: Cell }) {
  const tone = cell.tone === 'bad' ? ' regs__fact--bad' : cell.tone === 'warn' ? ' regs__fact--warn' : cell.tone === 'ok' ? ' regs__fact--ok' : '';
  return (
    <span className={`regs__fact${tone}`}>
      <span className="regs__fact-label">{label}</span>
      <span className="regs__fact-text">{cell.text}</span>
      {cell.sub ? <span className="regs__fact-sub">{cell.sub}</span> : null}
    </span>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`fieldcell regs__field${wide ? ' regs__field--wide' : ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && !error && <p className="notice" role="status">{notice}</p>}
    </>
  );
}

export const blankToNull = (v: string) => (v.trim() ? v.trim() : null);

/** A whole number of months from 1 to 60, or blank. Throws with the reason otherwise. */
export function readMonths(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error('The interval is a whole number of months, 1 to 60, or blank.');
  return n;
}
