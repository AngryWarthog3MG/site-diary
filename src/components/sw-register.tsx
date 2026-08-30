'use client';

import { useEffect } from 'react';

/** Registers the service worker so the app shell opens with no signal. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // No service worker means no offline shell; capture and the queue are
      // unaffected, so this is never worth interrupting anyone over.
    });
  }, []);

  return null;
}
