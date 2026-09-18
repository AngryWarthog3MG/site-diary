/**
 * Undo and redo for a screen that edits an unsigned draft. Pure, relative
 * imports only — node-tested.
 *
 * What it is NOT: a way back into the record. A signed entry is immutable and a
 * frozen row is frozen (README non-negotiable 2), so undo lives only where the
 * supervisor is still working on a draft the app has not stored as final — the
 * day's review screen. Each step is a whole snapshot of what the screen holds,
 * so undo restores exactly what was there, and the draft's own autosave writes
 * it back the way any other change is written.
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** How many steps back a person can go. Beyond this the oldest is dropped. */
export const LIMIT = 50;

export function begin<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a new state. Doing something new after undoing drops what was undone, as every editor does. */
export function record<T>(h: History<T>, present: T, limit = LIMIT): History<T> {
  if (Object.is(h.present, present)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present, future: [] };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const present = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const [present, ...rest] = h.future;
  return { past: [...h.past, h.present], present, future: rest };
}

/** How many steps are behind and ahead — for the buttons' titles. */
export const depth = <T>(h: History<T>): { back: number; forward: number } => ({ back: h.past.length, forward: h.future.length });
