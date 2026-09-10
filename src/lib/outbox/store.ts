'use client';

import { createStore, get, set, del, entries as idbEntries } from 'idb-keyval';

/**
 * The outbox: prestarts, sign-ons, finishes and plant checks done with no
 * signal, kept on the phone until they can be sent. Same idea as the capture
 * queue, for the forms rather than the recordings. Each item is one complete
 * action with the blobs it needs, replayed in the order it happened.
 */
const store = createStore('site-diary', 'outbox');

export type OutboxKind =
  | 'prestart_create'
  | 'prestart_edit'
  | 'prestart_attendee'
  | 'prestart_finish'
  | 'talk_attendee'
  | 'talk_finish'
  | 'plant_prestart';

export type OutboxState = 'queued' | 'syncing' | 'blocked' | 'failed';

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  projectId: string;
  /** What this item is about — a prestart, talk or plant prestart id — for grouping and ordering. */
  subjectId: string;
  createdAt: string;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  payload: Record<string, unknown>;
  blobs?: Record<string, Blob>;
}

export type OutboxSummary = Omit<OutboxItem, 'blobs'>;

export const KIND_LABEL: Record<OutboxKind, string> = {
  prestart_create: 'a prestart',
  prestart_edit: 'a prestart change',
  prestart_attendee: 'a sign-on',
  prestart_finish: 'a finished prestart',
  talk_attendee: 'a toolbox sign-on',
  talk_finish: 'a finished toolbox talk',
  plant_prestart: 'a plant check',
};

const CHANGED = 'outbox-changed';
function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}
export function onOutboxChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ob-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export async function enqueue(input: {
  kind: OutboxKind; projectId: string; subjectId: string; payload: Record<string, unknown>; blobs?: Record<string, Blob>;
}): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: newId(), kind: input.kind, projectId: input.projectId, subjectId: input.subjectId,
    createdAt: new Date().toISOString(), state: 'queued', attempts: 0, nextAttemptAt: 0,
    payload: input.payload, blobs: input.blobs,
  };
  await set(item.id, item, store);
  announce();
  return item;
}

export async function all(): Promise<OutboxItem[]> {
  const rows = await idbEntries<string, OutboxItem>(store);
  return rows.map(([, v]) => v).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function summaries(): Promise<OutboxSummary[]> {
  return (await all()).map(({ blobs: _b, ...rest }) => rest);
}

export async function forSubject(subjectId: string): Promise<OutboxItem[]> {
  return (await all()).filter((i) => i.subjectId === subjectId);
}

export async function patch(id: string, changes: Partial<OutboxItem>): Promise<void> {
  const current = await get<OutboxItem>(id, store);
  if (!current) return;
  await set(id, { ...current, ...changes }, store);
  announce();
}

export async function remove(id: string): Promise<void> {
  await del(id, store);
  announce();
}

export async function pendingCount(): Promise<number> {
  return (await all()).length;
}
