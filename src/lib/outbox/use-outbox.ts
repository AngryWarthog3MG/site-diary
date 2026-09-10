'use client';

import { useCallback, useEffect, useState } from 'react';
import * as outbox from './store';
import type { OutboxSummary } from './store';
import { drainOutbox } from './sync';

/** What is waiting on this phone, and a way to send it. Drains when signal returns. */
export function useOutbox() {
  const [items, setItems] = useState<OutboxSummary[]>([]);
  const [online, setOnline] = useState(true);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => setItems(await outbox.summaries()), []);
  const drain = useCallback(async () => {
    setSending(true);
    try { await drainOutbox(); } finally { setSending(false); await refresh(); }
  }, [refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh().then(() => { if (navigator.onLine) void drain(); });
    const up = () => { setOnline(true); void drain(); };
    const down = () => setOnline(false);
    const visible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void drain(); };
    const stop = outbox.onOutboxChange(() => void refresh());
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    document.addEventListener('visibilitychange', visible);
    return () => { stop(); window.removeEventListener('online', up); window.removeEventListener('offline', down); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, drain]);

  return { items, online, sending, drain, refresh };
}
