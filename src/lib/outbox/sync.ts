'use client';

import { createClient } from '@/lib/supabase/client';
import * as outbox from './store';
import type { OutboxItem } from './store';
import { isNetworkError, isPermissionError, isAlreadyDone, isFrozen, backoffMs, isOnline } from './offline';

/**
 * Replay what was done offline, in the order it happened, with the same
 * writes the screens make when they have signal. Each item is idempotent —
 * ids are chosen on the phone, so a retry that finds its work already done
 * is a success, not a duplicate.
 */
let running = false;

const BUCKET = 'entry-photos';

async function uploadIfMissing(path: string, blob: Blob, contentType: string) {
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error && !isAlreadyDone(error)) throw error;
}

async function replay(item: OutboxItem): Promise<void> {
  const supabase = createClient();
  const p = item.payload;
  const blobs = item.blobs ?? {};
  switch (item.kind) {
    case 'prestart_create': {
      const { error } = await supabase.from('prestarts').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'prestart_edit': {
      const { error } = await supabase.from('prestarts').update(p.changes as Record<string, unknown>).eq('id', item.subjectId);
      if (error) throw error;
      return;
    }
    case 'prestart_attendee': {
      await uploadIfMissing(p.path as string, blobs.signature, 'image/png');
      const { error } = await supabase.from('prestart_attendees').insert({
        id: p.attendeeId, prestart_id: item.subjectId, attendee_name: p.name, fit_for_work: p.fit, signature_path: p.path, created_at: p.at,
      });
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'prestart_finish': {
      const { error } = await supabase.from('prestarts')
        .update({ completed_at: new Date().toISOString(), completed_on_device_at: p.at }).eq('id', item.subjectId);
      if (error && !isFrozen(error)) throw error;
      return;
    }
    case 'talk_attendee': {
      await uploadIfMissing(p.path as string, blobs.signature, 'image/png');
      const { error } = await supabase.from('toolbox_attendees').insert({
        id: p.attendeeId, talk_id: item.subjectId, attendee_name: p.name, signature_path: p.path,
      });
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'talk_finish': {
      const { error } = await supabase.from('toolbox_talks')
        .update({ completed_at: new Date().toISOString(), completed_on_device_at: p.at }).eq('id', item.subjectId);
      if (error && !isFrozen(error)) throw error;
      return;
    }
    case 'plant_prestart': {
      if (p.putOnJob) {
        const { error } = await supabase.from('project_plant')
          .upsert({ project_id: item.projectId, plant_id: p.plantId, active: true }, { onConflict: 'project_id,plant_id' });
        if (error) throw error;
      }
      const { error: rowErr } = await supabase.from('plant_prestarts').insert(p.row as Record<string, unknown>);
      if (rowErr && !isAlreadyDone(rowErr)) throw rowErr;
      for (const d of (p.defects as Array<{ row: Record<string, unknown>; photoKey?: string; photoPath?: string; contentType?: string }>) ?? []) {
        if (d.photoKey && blobs[d.photoKey] && d.photoPath) await uploadIfMissing(d.photoPath, blobs[d.photoKey], d.contentType ?? 'image/jpeg');
        const { error } = await supabase.from('plant_defects').insert(d.row);
        if (error && !isAlreadyDone(error) && !isFrozen(error)) throw error;
      }
      await uploadIfMissing(p.sigPath as string, blobs.signature, 'image/png');
      const { error: doneErr } = await supabase.from('plant_prestarts')
        .update({ signature_path: p.sigPath, completed_on_device_at: p.at }).eq('id', item.subjectId);
      if (doneErr && !isFrozen(doneErr)) throw doneErr;
      return;
    }
  }
}

export interface OutboxReport { sent: number; failed: number; blocked: number; remaining: number }

export async function drainOutbox(): Promise<OutboxReport> {
  const report: OutboxReport = { sent: 0, failed: 0, blocked: 0, remaining: 0 };
  if (running || !isOnline()) {
    report.remaining = await outbox.pendingCount();
    return report;
  }
  running = true;
  try {
    const items = await outbox.all();
    // A subject whose earlier item failed this pass waits: a sign-on cannot
    // land before its prestart.
    const stalled = new Set<string>();
    for (const item of items) {
      if (item.state === 'blocked') { report.blocked += 1; continue; }
      if (stalled.has(item.subjectId)) { report.remaining += 1; continue; }
      // Every drain is prompted by something — signal back, the app opened, a
      // tap — so every drain tries. nextAttemptAt is kept for the record of
      // what happened, not as a gate: with no signal there is nothing to loop.
      await outbox.patch(item.id, { state: 'syncing' });
      try {
        await replay(item);
        await outbox.remove(item.id);
        report.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
        if (isPermissionError(error)) {
          await outbox.patch(item.id, { state: 'blocked', lastError: message });
          report.blocked += 1;
        } else {
          const attempts = item.attempts + 1;
          await outbox.patch(item.id, {
            state: isNetworkError(error) ? 'queued' : 'failed',
            attempts,
            nextAttemptAt: Date.now() + backoffMs(attempts),
            lastError: message,
          });
          report.failed += 1;
        }
        stalled.add(item.subjectId);
      }
    }
    report.remaining += (await outbox.all()).filter((i) => i.state !== 'blocked').length - 0;
  } finally {
    running = false;
  }
  return report;
}

/**
 * Do it now if there is signal; keep it on the phone if there is not, or if
 * the network drops midway. Returns how it went so the screen can say so.
 */
export async function runOrQueue(
  live: () => Promise<void>,
  queue: () => Promise<void>,
): Promise<'sent' | 'queued'> {
  if (!isOnline()) { await queue(); return 'queued'; }
  try {
    await live();
    return 'sent';
  } catch (error) {
    if (isNetworkError(error)) { await queue(); return 'queued'; }
    throw error;
  }
}
