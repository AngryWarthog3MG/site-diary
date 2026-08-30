'use client';

import { useEffect, useState } from 'react';
import * as sync from '@/lib/capture/sync';
import * as queue from '@/lib/capture/queue';
import type { QueueSummary } from '@/lib/capture/queue';

function describe(item: QueueSummary): string {
  const seconds = Math.round(item.durationMs / 1000);
  const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (item.state === 'blocked') return `${item.entryDate} · ${length} · ${item.lastError}`;
  if (item.state === 'syncing') return `${item.entryDate} · ${length} · sending`;
  if (item.lastError) return `${item.entryDate} · ${length} · ${item.lastError}`;
  return `${item.entryDate} · ${length} · waiting for signal`;
}

/**
 * What is still on the phone. Deliberately visible rather than tucked away:
 * a supervisor who has driven off site with an unsynced recording needs to
 * know that, and blocked items need a decision from them, not a silent retry.
 */
export function QueueStatus() {
  const [items, setItems] = useState<QueueSummary[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = sync.subscribe(setItems);
    const stop = sync.startSyncLoop();

    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      unsubscribe();
      stop();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  if (items.length === 0) {
    return online ? null : (
      <p className="notice gap">No signal. Recording still works — it will send itself later.</p>
    );
  }

  const blocked = items.filter((i) => i.state === 'blocked');
  const pending = items.filter((i) => i.state !== 'blocked');

  return (
    <section>
      {pending.length > 0 && (
        <>
          <p className="label">On this phone ({pending.length})</p>
          <ul className="queue">
            {pending.map((item) => (
              <li key={item.id} className="mono">
                {describe(item)}
              </li>
            ))}
          </ul>
        </>
      )}

      {blocked.map((item) => (
        <div key={item.id} className="notice gap">
          <p style={{ margin: 0 }}>{describe(item)}</p>
          <button
            type="button"
            className="button button--quiet"
            onClick={async () => {
              await queue.discard(item.id);
              await sync.drain();
            }}
          >
            Discard this recording
          </button>
        </div>
      ))}
    </section>
  );
}
