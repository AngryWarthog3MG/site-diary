'use client';

import { createClient } from '@/lib/supabase/client';
import { extensionFor } from './recorder';
import * as queue from './queue';
import type { QueueItem, QueueSummary } from './queue';

/**
 * Drains the offline queue.
 *
 * Every step is idempotent and its result is written back to the queue item
 * before the next one starts, so a phone that loses signal halfway resumes
 * where it stopped rather than starting over:
 *
 *   1. find or create the day's draft entry      -> item.entryId
 *   2. upload/register the raw capture           -> item.storagePath/item.registered
 *   3. transcribe audio, or append typed text
 *   4. extract from the raw transcript
 *   5. only then delete the local copy
 *
 * The blob is never deleted before step 3 confirms the server has it.
 */

const AUDIO_BUCKET = 'entry-audio';
const MAX_BACKOFF_MS = 30 * 60 * 1000;

export interface SyncReport {
  synced: number;
  failed: number;
  blocked: number;
  remaining: number;
}

type Listener = (summaries: QueueSummary[]) => void;
const listeners = new Set<Listener>();
let running = false;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void notify();
  return () => listeners.delete(listener);
}

async function notify() {
  const rows = await queue.summaries();
  listeners.forEach((l) => l(rows));
}

/**
 * Coalesced notify for the sync pipeline's stage transitions. Each stage used
 * to trigger a full IndexedDB read-and-sort — seven per item, seventy for a
 * ten-item backlog. The UI only needs the latest state, so trailing-edge
 * debounce: many transitions, one rescan.
 */
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notifySoon() {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void notify();
  }, 150);
}

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 15_000 * 2 ** Math.min(attempts, 8));
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { response, json: json as Record<string, unknown> };
}

function errorMessage(json: Record<string, unknown>, fallback: string): string {
  const error = json.error as { message?: string; code?: string } | undefined;
  return error?.message ?? fallback;
}

function errorCode(json: Record<string, unknown>): string | undefined {
  return (json.error as { code?: string } | undefined)?.code;
}

function isTextItem(item: QueueItem): boolean {
  return item.kind === 'text';
}

async function progress(item: QueueItem, changes: Partial<QueueItem>): Promise<void> {
  await queue.patch(item.id, changes);
  notifySoon();
}

async function syncItem(item: QueueItem): Promise<'synced' | 'failed' | 'blocked'> {
  const supabase = createClient();

  // 1. The day's draft entry.
  let entryId = item.entryId;
  if (!entryId) {
    await progress(item, { stage: 'opening_entry' });
    const { response, json } = await postJson('/api/entries', {
      projectId: item.projectId,
      entryDate: item.entryDate,
      asCorrection: item.asCorrection === true,
    });

    if (response.status === 409 && errorCode(json) === 'day_signed') {
      // The day is signed, so this recording becomes a correction — a new
      // entry superseding the signed one. That is the record model's own
      // answer to "something happened after signing", and a supervisor who
      // recorded onto a closed day plainly meant it to count.
      await progress(item, { asCorrection: true });
      const retry = await postJson('/api/entries', {
        projectId: item.projectId,
        entryDate: item.entryDate,
        asCorrection: true,
      });
      if (!retry.response.ok) {
        throw new Error(errorMessage(retry.json, 'Could not open a correction entry.'));
      }
      entryId = retry.json.entryId as string;
      await progress(item, { entryId });
    }
    if (response.status === 403) {
      await progress(item, {
        state: 'blocked',
        lastError: errorMessage(json, 'You cannot record on this project.'),
      });
      return 'blocked';
    }
    if (!entryId) {
      if (!response.ok) {
        throw new Error(errorMessage(json, 'Could not open the day’s entry.'));
      }
      entryId = json.entryId as string;
      await progress(item, { entryId });
    }
  }

  if (isTextItem(item)) {
    if (!item.text) {
      throw new Error('Typed diary text is missing.');
    }

    if (!item.registered) {
      await progress(item, { stage: 'appending_text' });
      const { response, json } = await postJson(`/api/entries/${entryId}/text`, {
        text: item.text,
        writtenAt: item.writtenAt,
        // The queue item's id is the idempotency key: a request that timed
        // out but landed must not append the note twice on retry.
        clientRef: item.id,
      });

      if (response.status === 409) {
        await progress(item, {
          state: 'blocked',
          lastError: errorMessage(json, 'That entry has been signed.'),
        });
        return 'blocked';
      }
      if (!response.ok) {
        throw new Error(errorMessage(json, 'Could not attach the typed diary text.'));
      }
      await progress(item, { registered: true });
    }

    void postJson(`/api/entries/${entryId}/weather`, {}).catch(() => {});

    await progress(item, { stage: 'extracting' });
    const { response, json } = await postJson(`/api/entries/${entryId}/extract`, {});
    if (!response.ok) {
      // 409: the day was signed while this waited — the text is already on
      // the server and no proposal can help a signed entry. Work is done,
      // not failed; retrying forever would wedge the queue on a 409 that
      // never changes.
      if (response.status === 409) {
        await queue.remove(item.id);
        return 'synced';
      }
      if (response.status === 403 || response.status === 404) {
        await progress(item, {
          state: 'blocked',
          lastError: errorMessage(json, 'This capture needs attention.'),
        });
        return 'blocked';
      }
      await progress(item, {
        state: 'queued',
        attempts: item.attempts + 1,
        nextAttemptAt: Date.now() + backoffMs(item.attempts + 1),
        lastError: errorMessage(json, 'Typed text is safe. Extraction will be retried.'),
      });
      return 'failed';
    }

    await queue.remove(item.id);
    return 'synced';
  }

  if (!item.blob || !item.mimeType || typeof item.durationMs !== 'number' || !item.recordedAt) {
    throw new Error('Recording data is missing.');
  }

  // 2. Upload the audio, straight to storage under the caller's own RLS.
  let storagePath = item.storagePath;
  if (!storagePath) {
    await progress(item, { stage: 'uploading' });
    storagePath = `${item.projectId}/${entryId}/${item.id}.${extensionFor(item.mimeType)}`;
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(storagePath, item.blob, {
        contentType: item.mimeType,
        upsert: true, // a retry re-sends the same bytes to the same path
      });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    await progress(item, { storagePath });
  }

  // 3. Register it. Past this point the recording is safe on the server.
  if (!item.registered) {
    await progress(item, { stage: 'registering' });
    const { response, json } = await postJson(`/api/entries/${entryId}/audio`, {
      clientRef: item.id,
      storagePath,
      mimeType: item.mimeType,
      durationMs: item.durationMs,
      recordedAt: item.recordedAt,
    });

    if (response.status === 409) {
      await progress(item, {
        state: 'blocked',
        lastError: errorMessage(json, 'That entry has been signed.'),
      });
      return 'blocked';
    }
    if (!response.ok) {
      throw new Error(errorMessage(json, 'Could not attach the recording.'));
    }
    await progress(item, { registered: true });
  }

  // Attach the day's observations while there is signal. Best effort: weather
  // is fetched again on every Today screen load and merged, so missing it here
  // costs nothing.
  void postJson(`/api/entries/${entryId}/weather`, {}).catch(() => {});

  // 4. Transcription. A failure here is not a lost recording — the segment is
  //    stored and the transcribe route can be called again at any time.
  await progress(item, { stage: 'transcribing' });
  const { response, json } = await postJson(`/api/entries/${entryId}/transcribe`, {});
  if (!response.ok) {
    // 409: the entry was signed with the recording safely registered — the
    // record is closed and there is nothing left for this item to do.
    if (response.status === 409) {
      await queue.remove(item.id);
      return 'synced';
    }
    if (response.status === 403 || response.status === 404) {
      await progress(item, {
        state: 'blocked',
        lastError: errorMessage(json, 'This capture needs attention.'),
      });
      return 'blocked';
    }
    await progress(item, {
      state: 'queued',
      attempts: item.attempts + 1,
      nextAttemptAt: Date.now() + backoffMs(item.attempts + 1),
      lastError: errorMessage(json, 'Recording is safe. Transcription will be retried.'),
    });
    return 'failed';
  }

  // 5. Extraction, once there are words to extract from. The proposal waits
  //    for the supervisor on the review screen — nothing it produces reaches
  //    the record without them.
  await progress(item, { stage: 'extracting' });
  const extracted = await postJson(`/api/entries/${entryId}/extract`, {});
  if (!extracted.response.ok) {
    // Signed while queued: the recording and transcript are on the server,
    // and a signed entry takes no proposal. Done, not stuck.
    if (extracted.response.status === 409) {
      await queue.remove(item.id);
      return 'synced';
    }
    if (extracted.response.status === 403 || extracted.response.status === 404) {
      await progress(item, {
        state: 'blocked',
        lastError: errorMessage(extracted.json, 'This capture needs attention.'),
      });
      return 'blocked';
    }
    await progress(item, {
      state: 'queued',
      attempts: item.attempts + 1,
      nextAttemptAt: Date.now() + backoffMs(item.attempts + 1),
      lastError: errorMessage(extracted.json, 'Recording and transcript are safe. Extraction will be retried.'),
    });
    return 'failed';
  }

  // 6. Server has everything. Let the local copy go.
  await queue.remove(item.id);
  return 'synced';
}

export async function drain(): Promise<SyncReport> {
  if (running || typeof navigator === 'undefined' || !navigator.onLine) {
    const rows = await queue.all();
    return { synced: 0, failed: 0, blocked: 0, remaining: rows.length };
  }

  running = true;
  const report: SyncReport = { synced: 0, failed: 0, blocked: 0, remaining: 0 };

  try {
    for (const item of await queue.all()) {
      if (item.state === 'blocked') {
        // Recordings stranded by "day already signed" before corrections
        // existed get one automatic second life as a correction.
        if (!item.asCorrection && /already been signed/i.test(item.lastError ?? '')) {
          await queue.patch(item.id, { state: 'queued', asCorrection: true, nextAttemptAt: 0 });
        } else {
          continue;
        }
      }
      if (item.nextAttemptAt > Date.now()) continue;

      await queue.patch(item.id, {
        state: 'syncing',
        lastAttemptAt: Date.now(),
        lastError: undefined,
      });
      await notify();

      try {
        const outcome = await syncItem(item);
        report[outcome === 'synced' ? 'synced' : outcome === 'blocked' ? 'blocked' : 'failed'] += 1;
      } catch (error) {
        const attempts = item.attempts + 1;
        await queue.patch(item.id, {
          state: 'queued',
          attempts,
          nextAttemptAt: Date.now() + backoffMs(attempts),
          lastError: error instanceof Error ? error.message : 'Sync failed.',
        });
        report.failed += 1;
      }
      await notify();
    }
  } finally {
    running = false;
    report.remaining = (await queue.all()).length;
    await notify();
  }

  return report;
}

/**
 * Retry whenever the situation changes: signal returns, the app comes back to
 * the foreground, or the backoff timer comes round.
 */
export function startSyncLoop(intervalMs = 30_000): () => void {
  const kick = () => void drain();

  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
  const timer = window.setInterval(kick, intervalMs);
  kick();

  return () => {
    window.removeEventListener('online', kick);
    window.clearInterval(timer);
  };
}
