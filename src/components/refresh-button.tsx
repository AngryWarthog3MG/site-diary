'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { drain } from '@/lib/capture/sync';

/**
 * One button, top of every screen: send anything still waiting on the
 * phone, pick up the latest build, and load the screen again from the
 * server. It exists because "is this up to date?" should never be a
 * question you have to answer by guessing.
 */
export function RefreshButton() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  if (/^\/(signin|auth|verify|offline)/.test(pathname)) return null;

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      // Queued recordings first, so a reload cannot outrun them.
      await Promise.race([drain(), new Promise((r) => setTimeout(r, 8000))]);
    } catch {
      // Offline or mid-failure: the queue keeps them; the reload is still useful.
    }
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
    } catch {
      // No service worker — nothing to update.
    }
    window.location.reload();
  }

  return (
    <button
      type="button"
      className={`refresh-button${busy ? ' refresh-button--busy' : ''}`}
      onClick={refresh}
      disabled={busy}
      aria-label="Refresh"
      title="Send anything waiting, then load the latest"
    >
      <span className="refresh-button__icon" aria-hidden>↻</span>
      <span>{busy ? 'Syncing…' : 'Refresh'}</span>
    </button>
  );
}
