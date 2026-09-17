'use client';

import { normaliseName } from '../crew/tickets';
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

async function uploadIfMissing(path: string, blob: Blob, contentType: string, bucket = BUCKET) {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType, upsert: false });
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
      // A finished prestart is out of reach under RLS, so the update touches
      // no row and returns no error. That is not success: the change did not
      // land, and the person who made it must hear so.
      const { data, error } = await supabase.from('prestarts').update(p.changes as Record<string, unknown>).eq('id', item.subjectId).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw Object.assign(new Error('The prestart was finished before this change reached it; the change was not applied.'), { code: '42501' });
      return;
    }
    case 'prestart_attendee': {
      await uploadIfMissing(p.path as string, blobs.signature, 'image/png');
      const { error } = await supabase.from('prestart_attendees').insert({
        id: p.attendeeId, prestart_id: item.subjectId, attendee_name: p.name, fit_for_work: p.fit, signature_path: p.path, created_at: p.at, inducted: (p.inducted as boolean | null | undefined) ?? null,
      });
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'prestart_finish': {
      // completed_at is stamped by the database; the value sent only says "now".
      const { data, error } = await supabase.from('prestarts')
        .update({ completed_at: new Date().toISOString(), completed_on_device_at: p.at }).eq('id', item.subjectId).select('id, completed_at');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        // Out of reach: already finished (fine) or gone. Check which.
        const { data: row } = await supabase.from('prestarts').select('completed_at').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That prestart no longer exists.'), { code: '42501' });
        if (!row.completed_at) throw Object.assign(new Error('The prestart could not be finished from this account; it is still open.'), { code: '42501' });
      }
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
      const { data, error } = await supabase.from('toolbox_talks')
        .update({ completed_at: new Date().toISOString(), completed_on_device_at: p.at }).eq('id', item.subjectId).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        const { data: row } = await supabase.from('toolbox_talks').select('completed_at').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That talk no longer exists.'), { code: '42501' });
        if (!row.completed_at) throw Object.assign(new Error('The talk could not be finished from this account; it is still open.'), { code: '42501' });
      }
      return;
    }
    case 'doc_ack': {
      await uploadIfMissing(p.path as string, blobs.signature, 'image/png');
      const { error } = await supabase.from('document_acknowledgements').insert({
        id: p.ackId, version_id: item.subjectId, person_name: p.name, signature_path: p.path, project_id: item.projectId, recorded_by: p.by, acknowledged_on_device_at: p.at,
      });
      // A new version was issued while this waited: the signature was to the
      // old words and can never land. Done, not retried; the nightly check
      // reports the stranded file. The person signs the new version.
      if (error && /superseded/i.test(String((error as { message?: string }).message ?? ''))) return;
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'permit_issue': {
      // The row, then both signatures, then the issue that the database checks.
      const { error: rowErr } = await supabase.from('permits').insert({ id: item.subjectId, project_id: item.projectId, ...(p.row as Record<string, unknown>) });
      if (rowErr && !isAlreadyDone(rowErr)) throw rowErr;
      await uploadIfMissing(p.issuerPath as string, blobs.issuer, 'image/png');
      await uploadIfMissing(p.holderPath as string, blobs.holder, 'image/png');
      const { data: issued, error: issueErr } = await supabase.from('permits')
        .update({ status: 'issued', issuer_signature_path: p.issuerPath, holder_signature_path: p.holderPath, issued_on_device_at: p.at }).eq('id', item.subjectId).select('id');
      if (issueErr && !isFrozen(issueErr)) throw issueErr;
      if (!issueErr && (!issued || issued.length === 0)) {
        const { data: row } = await supabase.from('permits').select('status').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That permit no longer exists.'), { code: '42501' });
        if (row.status === 'open') throw Object.assign(new Error('The permit could not be issued from this account; it is still open.'), { code: '42501' });
      }
      return;
    }
    case 'permit_close': {
      await uploadIfMissing(p.sigPath as string, blobs.signature, 'image/png');
      const { data: closed, error } = await supabase.from('permits')
        .update({ status: 'closed', closeout_checks: p.checks, closeout_note: p.note ?? null, closeout_signature_path: p.sigPath, closed_on_device_at: p.at }).eq('id', item.subjectId).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!closed || closed.length === 0)) {
        const { data: row } = await supabase.from('permits').select('status').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That permit no longer exists.'), { code: '42501' });
        if (row.status === 'issued') throw Object.assign(new Error('The permit could not be closed from this account; it is still issued.'), { code: '42501' });
      }
      return;
    }
    case 'inspection_submit': {
      // Photos, then the row with its items, then the signature that completes it.
      const paths = (p.photoPaths as Array<{ key: string; path: string; type: string }> | undefined) ?? [];
      for (const ph of paths) if (blobs[ph.key]) await uploadIfMissing(ph.path, blobs[ph.key], ph.type);
      const { error: rowErr } = await supabase.from('inspections').insert({ id: item.subjectId, project_id: item.projectId, ...(p.row as Record<string, unknown>) });
      if (rowErr && !isAlreadyDone(rowErr)) throw rowErr;
      await uploadIfMissing(p.sigPath as string, blobs.signature, 'image/png');
      const { data: signed, error: doneErr } = await supabase.from('inspections')
        .update({ signature_path: p.sigPath, completed_on_device_at: p.at }).eq('id', item.subjectId).select('id');
      if (doneErr && !isFrozen(doneErr)) throw doneErr;
      if (!doneErr && (!signed || signed.length === 0)) {
        const { data: row } = await supabase.from('inspections').select('completed_at').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That inspection no longer exists.'), { code: '42501' });
        if (!row.completed_at) throw Object.assign(new Error('The inspection could not be signed from this account; it is still open.'), { code: '42501' });
      }
      return;
    }
    case 'incident_report': {
      // Photos first, each to its own path, then the report that names them;
      // the number is issued by the database. The office is told afterwards.
      const paths = (p.photoPaths as string[] | undefined) ?? [];
      for (let i = 0; i < paths.length; i += 1) {
        const blob = blobs[`photo-${i}`];
        if (blob) await uploadIfMissing(paths[i], blob, (p.photoTypes as string[] | undefined)?.[i] ?? 'image/jpeg');
      }
      const { error } = await supabase.from('incidents').insert({
        id: item.subjectId, project_id: item.projectId, ...(p.row as Record<string, unknown>), photo_urls: paths, reported_on_device_at: p.at,
      });
      if (error && !isAlreadyDone(error)) throw error;
      await fetch(`/api/incidents/${item.subjectId}/notify`, { method: 'POST' }).catch(() => undefined);
      return;
    }
    case 'order_raise': {
      // Photos first, then the request that names them; the number is the database's.
      const paths = (p.photoPaths as string[] | undefined) ?? [];
      for (let i = 0; i < paths.length; i += 1) {
        const blob = blobs[`photo-${i}`];
        if (blob) await uploadIfMissing(paths[i], blob, (p.photoTypes as string[] | undefined)?.[i] ?? 'image/jpeg');
      }
      const { error } = await supabase.from('orders').insert({
        id: item.subjectId, project_id: item.projectId, ...(p.row as Record<string, unknown>), photo_urls: paths, raised_on_device_at: p.at,
      });
      if (error && !isAlreadyDone(error)) throw error;
      if ((p.row as { urgent?: boolean }).urgent) await fetch(`/api/orders/${item.subjectId}/notify`, { method: 'POST' }).catch(() => undefined);
      return;
    }
    case 'order_status': {
      // Ordered, received, fixed or cancelled from the phone with no signal. A
      // request finished by someone else in the meantime is frozen: done is done.
      const { data, error } = await supabase.from('orders').update(p.patch as Record<string, unknown>).eq('id', item.subjectId).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        // Nothing changed and no error: either it was finished by someone else
        // (done is done) or this account can no longer see or move it — which is
        // a blocked item to show, never a change to drop on the floor.
        const { data: row } = await supabase.from('orders').select('status').eq('id', item.subjectId).maybeSingle();
        if (!row || row.status === 'open' || row.status === 'ordered') {
          throw Object.assign(new Error('The change could not be recorded from this account.'), { code: '42501' });
        }
      }
      return;
    }
    // README R76: the subcontractor's site forms, kept on the phone with no signal like the rest.
    case 'hc_notice': {
      // Waits behind its incident (same subject), so a report made offline lands first.
      const { error } = await supabase.from('incident_notices').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'swms_review': {
      // In the order recorded on the phone: the database refuses "accepted" before "submitted".
      const { error } = await supabase.from('swms_reviews').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'env_monitoring': {
      const { error } = await supabase.from('env_monitoring_records').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'hc_document': {
      // The copy first, then the row that names it, then the older copy marked superseded.
      if (p.path && blobs.file) await uploadIfMissing(p.path as string, blobs.file, (p.contentType as string) ?? 'application/pdf', 'head-contractor-docs');
      const { error } = await supabase.from('head_contractor_documents').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      if (p.supersedes) {
        const { error: se } = await supabase.from('head_contractor_documents').update({ superseded_by: item.subjectId }).eq('id', p.supersedes as string);
        // Already superseded by another copy while this waited: that copy stands, this one is kept alongside.
        if (se && !isFrozen(se)) throw se;
      }
      return;
    }
    case 'swms_signon': {
      await uploadIfMissing(p.path as string, blobs.signature, 'image/png');
      const { error } = await supabase.from('swms_signons').insert({
        id: p.signonId, swms_id: item.subjectId, attendee_name: p.name, signature_path: p.path, signed_on_device_at: p.at, created_by: p.by,
      });
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'signin_in': {
      // The row's id and the phone's time were chosen at the gate; the
      // database stamps the arrival and decides `inducted` itself.
      const { error } = await supabase.from('site_signins').insert({
        id: item.subjectId, project_id: item.projectId, signin_date: p.date, person_name: p.name,
        company: p.company ?? null, person_kind: p.kind, signed_in_on_device_at: p.at, signed_in_by: p.by,
      });
      // Two phones signed the same person in while offline: the first row in
      // wins and this one is not needed — the person is on site. Its sign-out,
      // if queued, finds the open row by name (below). The same id twice is
      // the ordinary replay case.
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'signin_out': {
      const { data, error } = await supabase.from('site_signins')
        .update({ signed_out_at: new Date().toISOString(), signed_out_on_device_at: p.at }).eq('id', item.subjectId).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        const { data: row } = await supabase.from('site_signins').select('signed_out_at').eq('id', item.subjectId).maybeSingle();
        if (row && !row.signed_out_at) throw Object.assign(new Error('The sign-out could not be recorded from this account.'), { code: '42501' });
        if (!row) {
          // This phone's sign-in lost to another phone's for the same person:
          // sign out whichever row is open for that name on that day.
          const key = normaliseName(String(p.name ?? ''));
          const { data: open } = await supabase.from('site_signins').select('id, person_name')
            .eq('project_id', item.projectId).eq('signin_date', p.date).is('signed_out_at', null);
          const match = (open ?? []).find((r) => normaliseName(String(r.person_name)) === key);
          if (!match) throw Object.assign(new Error('That sign-in no longer exists and nobody by that name is on site.'), { code: '42501' });
          const { error: e2 } = await supabase.from('site_signins')
            .update({ signed_out_at: new Date().toISOString(), signed_out_on_device_at: p.at }).eq('id', match.id);
          if (e2 && !isFrozen(e2)) throw e2;
        }
      }
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
