'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Screens where nothing is half-typed, so a reload costs nothing. Anywhere
 * else — recording, the entry screen, a talk mid-sign-on — the phone gets a
 * banner and decides for itself.
 */
const SAFE_TO_RELOAD = new Set([
  '/', '/entries', '/toolbox', '/prestart', '/claims', '/progress', '/portfolio',
  '/reports/weekly', '/settings',
]);
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Registers the service worker so the app shell opens with no signal — and
 * keeps an installed phone app from running last week's code.
 *
 * An installed PWA is never really closed. Switching away and back resumes
 * the same JavaScript session, so a phone that opened the diary on Monday is
 * still running Monday's build on Thursday however many times the desktop
 * has seen new screens. Nothing in the platform tells it otherwise. So every
 * time the app comes to the front (and every few minutes while it is there)
 * it asks the server which build is live, and if that is not the build it
 * was born with it reloads — silently on a screen with nothing to lose,
 * otherwise with a banner to tap.
 */
export function ServiceWorkerRegistration() {
  const pathname = usePathname();
  const [behind, setBehind] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // No service worker means no offline shell; capture and the queue are
      // unaffected, so this is never worth interrupting anyone over.
    });
  }, []);

  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!mine || mine === 'dev') return;
    let stopped = false;

    const check = async () => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (stopped || !build || build === 'dev' || build === mine) return;

        // Let the service worker fetch its own new file while we are at it.
        navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});

        const active = document.activeElement;
        const typing = Boolean(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
        if (SAFE_TO_RELOAD.has(pathname) && !typing) {
          window.location.reload();
          return;
        }
        setBehind(true);
      } catch {
        // No signal. The next foregrounding tries again.
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [pathname]);

  if (!behind) return null;
  return (
    <button type="button" className="update-banner" onClick={() => window.location.reload()}>
      A newer version of the app is ready — tap to update
    </button>
  );
}
