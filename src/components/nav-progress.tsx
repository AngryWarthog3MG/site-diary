'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Something is happening (README R94). On one bar of signal a tap on a link
 * can sit for seconds with nothing on screen, and the phone gets tapped
 * again, or the app gets closed. The moment a same-site link is tapped a
 * bar starts across the top; if the page has not arrived after a beat, a
 * "Loading…" pill joins it. Both go when the route lands. Nothing here waits
 * on the network itself — it watches the tap and the address.
 */
export const navPending = {
  /** For a navigation started from code rather than a tap (the job switcher). */
  start: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('kbl:nav-start')); },
};

const GIVE_UP_MS = 25_000;
const PILL_AFTER_MS = 700;

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [phase, setPhase] = useState<'idle' | 'going' | 'done'>('idle');
  const [slow, setSlow] = useState(false);
  const giveUp = useRef<number | null>(null);
  const pillTimer = useRef<number | null>(null);
  const key = `${pathname}?${search.toString()}`;
  const wasGoing = useRef(false);

  // The address changed: the page is here. Finish the bar, drop the pill.
  useEffect(() => {
    if (!wasGoing.current) return;
    wasGoing.current = false;
    if (giveUp.current) window.clearTimeout(giveUp.current);
    if (pillTimer.current) window.clearTimeout(pillTimer.current);
    setSlow(false);
    setPhase('done');
    const t = window.setTimeout(() => setPhase('idle'), 450);
    return () => window.clearTimeout(t);
  }, [key]);

  useEffect(() => {
    const stop = () => {
      wasGoing.current = false;
      if (giveUp.current) window.clearTimeout(giveUp.current);
      if (pillTimer.current) window.clearTimeout(pillTimer.current);
      setSlow(false);
      setPhase('idle');
    };
    const begin = () => {
      wasGoing.current = true;
      setPhase('going');
      if (pillTimer.current) window.clearTimeout(pillTimer.current);
      pillTimer.current = window.setTimeout(() => setSlow(true), PILL_AFTER_MS);
      if (giveUp.current) window.clearTimeout(giveUp.current);
      giveUp.current = window.setTimeout(stop, GIVE_UP_MS);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      // The same page, or only a hash: nothing to wait for. A file or an API address: a download, not a page.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (url.pathname.startsWith('/api/') || /\.(pdf|csv|png|jpe?g|zip|json)$/i.test(url.pathname)) return;
      begin();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', begin);
    window.addEventListener('kbl:nav-start', begin);
    window.addEventListener('pageshow', stop);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', begin);
      window.removeEventListener('kbl:nav-start', begin);
      window.removeEventListener('pageshow', stop);
      if (giveUp.current) window.clearTimeout(giveUp.current);
      if (pillTimer.current) window.clearTimeout(pillTimer.current);
    };
  }, []);

  if (phase === 'idle') return null;
  return (
    <>
      <div className={`navbar-progress navbar-progress--${phase}`} role="progressbar" aria-label="Loading the page" aria-busy={phase === 'going'} data-nav-progress={phase} />
      {slow && phase === 'going' && (
        <div className="navpill" role="status" aria-live="polite" data-nav-pill>
          <span className="navpill__spin" aria-hidden>↻</span> Loading…
        </div>
      )}
    </>
  );
}
