'use client';

import { createStore, get, set, del, entries as idbEntries } from 'idb-keyval';

/**
 * The offline queue (brief §2.6). Captures and their draft metadata live in
 * IndexedDB from the moment the supervisor saves, and are only deleted once
 * the server has confirmed the raw material exists. Nothing about capture
 * requires a network.
 */

const store = createStore('site-diary', 'capture-queue');

export type QueueState = 'queued' | 'syncing' | 'blocked' | 'failed';
export type QueueStage =
  | 'saved_local'
  | 'opening_entry'
  | 'uploading'
  | 'registering'
  | 'appending_text'
  | 'transcribing'
  | 'extracting';

export interface QueueItem {
  /** Also the `clientRef` the server dedupes on, and the storage filename. */
  id: string;
  kind?: 'audio' | 'text';
  projectId: string;
  /** The device's local date. On site, "today" is the supervisor's day, not UTC's. */
  entryDate: string;
  blob?: Blob;
  mimeType?: string;
  durationMs?: number;
  recordedAt?: string;
  text?: string;
  writtenAt?: string;

  state: QueueState;
  stage?: QueueStage;
  attempts: number;
  nextAttemptAt: number;
  lastAttemptAt?: number;
  lastError?: string;

  /**
   * Set only by the supervisor's own choice: this recording is a correction
   * to a day already signed, and opens a new entry superseding it.
   */
  asCorrection?: boolean;
  /** Why the item stopped and is waiting on a decision rather than a retry. */
  blockedReason?: 'day_signed';

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
    kind: 'audio',
    ...input,
    state: 'queued',
    stage: 'saved_local',
    attempts: 0,
    nextAttemptAt: 0,
  };
  await set(item.id, item, store);
  return item;
}

export async function enqueueText(input: {
  projectId: string;
  entryDate: string;
  text: string;
  writtenAt: string;
}): Promise<QueueItem> {
  const item: QueueItem = {
    id: newId(),
    kind: 'text',
    ...input,
    state: 'queued',
    stage: 'saved_local',
    attempts: 0,
    nextAttemptAt: 0,
  };
  await set(item.id, item, store);
  return item;
}

function capturedAt(item: QueueItem): string {
  return item.recordedAt ?? item.writtenAt ?? '';
}

export async function all(): Promise<QueueItem[]> {
  const rows = await idbEntries<string, QueueItem>(store);
  return rows
    .map(([, value]) => value)
    .filter((v): v is QueueItem => Boolean(v?.id))
    .sort((a, b) => capturedAt(a).localeCompare(capturedAt(b)));
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
