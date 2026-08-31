'use client';

import { useEffect, useState } from 'react';
import * as sync from '@/lib/capture/sync';
import * as queue from '@/lib/capture/queue';
import type { QueueSummary } from '@/lib/capture/queue';

const STAGE_TEXT: Record<string, string> = {
  saved_local: 'Saved on this phone',
  opening_entry: 'Opening the diary entry',
  uploading: 'Uploading recording',
  registering: 'Attaching recording',
  appending_text: 'Attaching typed diary',
  transcribing: 'Transcribing',
  extracting: 'Structuring for review',
};

function kindLabel(item: QueueSummary): string {
  return item.kind === 'text' ? 'Typed diary' : 'Recording';
}

function lengthLabel(item: QueueSummary): string {
  if (item.kind === 'text' || typeof item.durationMs !== 'number') {
    return `${item.text?.length ?? 0} chars`;
  }
  const seconds = Math.round(item.durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function statusLabel(item: QueueSummary, online: boolean): string {
  if (item.state === 'blocked') return 'Needs attention';
  if (item.state === 'syncing') return STAGE_TEXT[item.stage ?? 'saved_local'] ?? 'Sending';
  if (item.nextAttemptAt > Date.now()) return 'Waiting to retry';
  return online ? 'Ready to send' : 'Waiting for signal';
}

function detailLabel(item: QueueSummary): string {
  if (item.lastError) return item.lastError;
  if (item.entryId && item.registered) return 'Raw capture is on the server; finishing processing.';
  if (item.entryId) return 'Diary entry is open; raw capture is still on this phone.';
  return 'Saved locally. It can leave the page safely.';
}

function timeLabel(value: number | undefined): string | null {
  if (!value) return null;
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function retryLabel(item: QueueSummary): string | null {
  if (item.state === 'blocked' || item.nextAttemptAt <= Date.now()) return null;
  const seconds = Math.max(0, Math.ceil((item.nextAttemptAt - Date.now()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} min`;
}

function preview(item: QueueSummary): string | null {
  if (item.kind !== 'text' || !item.text) return null;
  const text = item.text.trim().replace(/\s+/g, ' ');
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

/**
 * What is still on the phone. Deliberately visible rather than tucked away:
 * a supervisor who has driven off site with an unsynced recording needs to
 * know that, and blocked items need a decision from them, not a silent retry.
 */
export function QueueStatus() {
  const [items, setItems] = useState<QueueSummary[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

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

  async function retryNow(item: QueueSummary) {
    setBusy(`retry:${item.id}`);
    try {
      await queue.patch(item.id, {
        state: 'queued',
        nextAttemptAt: 0,
        lastError: undefined,
      });
      await sync.drain();
    } finally {
      setBusy(null);
    }
  }

  async function discard(item: QueueSummary) {
    setBusy(`discard:${item.id}`);
    try {
      await queue.discard(item.id);
      setConfirmDiscard(null);
      await sync.drain();
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return online ? null : (
      <section className="queue-panel queue-panel--offline">
        <p className="label">Offline</p>
        <p>No signal. Capture still works, and anything saved will send itself later.</p>
      </section>
    );
  }

  const blocked = items.filter((i) => i.state === 'blocked');
  const pending = items.filter((i) => i.state !== 'blocked');

  return (
    <section className="queue-panel">
      <div className="queue-panel__head">
        <div>
          <p className="label">On this phone</p>
          <h2>{items.length} capture{items.length === 1 ? '' : 's'} waiting</h2>
        </div>
        <span className={`queue-signal${online ? ' queue-signal--online' : ''}`}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="queue-cards">
        {[...blocked, ...pending].map((item) => {
          const retryIn = retryLabel(item);
          const lastTried = timeLabel(item.lastAttemptAt);
          const confirming = confirmDiscard === item.id;
          return (
            <article key={item.id} className={`queue-card queue-card--${item.state}`}>
              <div className="queue-card__main">
                <p className="label">
                  {kindLabel(item)} · {item.entryDate}
                </p>
                <h3>{statusLabel(item, online)}</h3>
                <p>{detailLabel(item)}</p>
                {preview(item) && <blockquote>{preview(item)}</blockquote>}
                <dl>
                  <div>
                    <dt>Length</dt>
                    <dd className="mono">{lengthLabel(item)}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd className="mono">{item.attempts}</dd>
                  </div>
                  <div>
                    <dt>Last tried</dt>
                    <dd className="mono">{lastTried ?? 'not yet'}</dd>
                  </div>
                  {retryIn && (
                    <div>
                      <dt>Retry in</dt>
                      <dd className="mono">{retryIn}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="queue-card__actions">
                {item.state !== 'blocked' && (
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={busy !== null || !online}
                    onClick={() => void retryNow(item)}
                  >
                    {busy === `retry:${item.id}` ? 'Retrying...' : 'Retry now'}
                  </button>
                )}

                {confirming ? (
                  <>
                    <p>Discard only if you are sure this capture is not needed.</p>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy !== null}
                      onClick={() => void discard(item)}
                    >
                      {busy === `discard:${item.id}` ? 'Discarding...' : 'Yes, discard'}
                    </button>
                    <button
                      type="button"
                      className="quotebtn"
                      disabled={busy !== null}
                      onClick={() => setConfirmDiscard(null)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="quotebtn quotebtn--remove"
                    disabled={busy !== null}
                    onClick={() => setConfirmDiscard(item.id)}
                  >
                    Discard
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
