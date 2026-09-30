'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Cell } from '@/lib/registers/model';
import { printHref } from '@/lib/registers/select';

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

/** Which lines the print will carry. Ticks live on the screen only; the address of the print carries them. */
export function usePick(all: readonly string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const only = (ids: readonly string[]) => setPicked(new Set(ids));
  const clear = () => setPicked(new Set());
  const list = all.filter((id) => picked.has(id));
  return { picked, toggle, only, clear, list };
}

/**
 * Print everything, only this job's lines, or exactly the ticked ones — the
 * register a head contractor is handed shows their job, not the whole company
 * (README R118). An extract says it is one on the page.
 */
export function PrintBar({ pdf, projectId, pick, all, onJob, jobCode }: {
  pdf: string; projectId: string; pick: ReturnType<typeof usePick>; all: readonly string[]; onJob?: readonly string[]; jobCode?: string;
}) {
  const n = pick.list.length;
  return (
    <div className="regs__print">
      <span className="label">Print</span>
      <a className="button button--quiet" href={printHref(pdf, projectId, { scope: 'all' })} target="_blank" rel="noreferrer">Everything</a>
      {onJob && <a className="button button--quiet" href={printHref(pdf, projectId, { scope: 'job' })} target="_blank" rel="noreferrer">Only on {jobCode ?? 'this job'} ({onJob.length})</a>}
      {n > 0
        ? <a className="button" href={printHref(pdf, projectId, { ids: pick.list })} target="_blank" rel="noreferrer">Selected only ({n})</a>
        : <span className="caption">Tick lines below to print a selection.</span>}
      <span className="regs__print-tools">
        {onJob && onJob.length > 0 && <button type="button" className="linklike" onClick={() => pick.only(onJob)}>Tick this job&rsquo;s</button>}
        <button type="button" className="linklike" onClick={() => pick.only(all)}>Tick all</button>
        {n > 0 && <button type="button" className="linklike" onClick={pick.clear}>Clear</button>}
      </span>
    </div>
  );
}

export function PickBox({ id, pick, label }: { id: string; pick: ReturnType<typeof usePick>; label: string }) {
  return (
    <label className="regs__pickbox" title="Include in a printed selection">
      <input type="checkbox" checked={pick.picked.has(id)} onChange={() => pick.toggle(id)} aria-label={`Include ${label} in the print`} />
    </label>
  );
}
