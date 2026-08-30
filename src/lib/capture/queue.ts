'use client';

import { createStore, get, set, del, entries as idbEntries } from 'idb-keyval';

/**
 * The offline queue (brief §2.6). Audio blobs and their draft metadata live in
 * IndexedDB from the moment recording stops, and are only deleted once the
 * server has confirmed the segment row exists. Nothing about capture requires
 * a network.
 */

const store = createStore('site-diary', 'capture-queue');

export type QueueState = 'queued' | 'syncing' | 'blocked' | 'failed';

export interface QueueItem {
  /** Also the `clientRef` the server dedupes on, and the storage filename. */
  id: string;
  projectId: string;
  /** The device's local date. On site, "today" is the supervisor's day, not UTC's. */
  entryDate: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  recordedAt: string;

  state: QueueState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;

  /** The day was signed, so this recording opens a superseding correction. */
  asCorrection?: boolean;

  /** Progress markers, so a resumed sync never repeats work it has done. */
  entryId?: string;
  storagePath?: string;
  registered?: boolean;
}

/** Metadata without the blob — safe to hold in React state. */
export type QueueSummary = Omit<QueueItem, 'blob'>;

export function summarise(item: QueueItem): QueueSummary {
  const { blob: _blob, ...rest } = item;
  return rest;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `rec-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** The device's local calendar date, which is what an entry_date means. */
export function localDate(at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function enqueue(input: {
  projectId: string;
  entryDate: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  recordedAt: string;
}): Promise<QueueItem> {
  const item: QueueItem = {
    id: newId(),
    ...input,
    state: 'queued',
    attempts: 0,
    nextAttemptAt: 0,
  };
  await set(item.id, item, store);
  return item;
}

export async function all(): Promise<QueueItem[]> {
  const rows = await idbEntries<string, QueueItem>(store);
  return rows
    .map(([, value]) => value)
    .filter((v): v is QueueItem => Boolean(v?.id))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export async function summaries(): Promise<QueueSummary[]> {
  return (await all()).map(summarise);
}

export async function put(item: QueueItem): Promise<void> {
  await set(item.id, item, store);
}

export async function patch(id: string, changes: Partial<QueueItem>): Promise<QueueItem | null> {
  const current = await get<QueueItem>(id, store);
  if (!current) return null;
  const next = { ...current, ...changes };
  await set(id, next, store);
  return next;
}

export async function remove(id: string): Promise<void> {
  await del(id, store);
}

export async function pendingCount(): Promise<number> {
  return (await all()).filter((i) => i.state !== 'blocked').length;
}

/** Clear a blocked item the supervisor has acknowledged. */
export async function discard(id: string): Promise<void> {
  await del(id, store);
}
