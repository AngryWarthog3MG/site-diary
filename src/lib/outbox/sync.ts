'use client';

import { normaliseName } from '../crew/tickets';
import { createClient } from '@/lib/supabase/client';
import * as outbox from './store';
import type { OutboxItem } from './store';
import { isNetworkError, isPermissionError, isAlreadyDone, isFrozen, backoffMs, isOnline } from './offline';
import { changeQaPhotos } from '../qa/photos';

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

/**
 * Mark `older` as replaced by `mine` — or, when another copy replaced `older` while this one waited,
 * follow the chain: a newer-or-same copy is replaced by mine only if mine is not older than it; if mine
 * is the older one, mine is marked replaced by it. Either way exactly one copy is left in force, and
 * never a guess about which (README R78).
 */
async function supersedeChain(older: string, mine: string, myReceivedOn: string): Promise<void> {
  const supabase = createClient();
  let target = older;
  for (let hop = 0; hop < 10; hop += 1) {
    const { data: row, error: readErr } = await supabase.from('head_contractor_documents').select('id, superseded_by, received_on').eq('id', target).maybeSingle();
    if (readErr) throw readErr;
    if (!row) return;
    if (row.superseded_by === mine) return;
    if (!row.superseded_by) {
      if ((row.received_on as string) <= myReceivedOn) {
        const { error } = await supabase.from('head_contractor_documents').update({ superseded_by: mine }).eq('id', target);
        if (error && !isFrozen(error)) throw error;
      } else {
        const { error } = await supabase.from('head_contractor_documents').update({ superseded_by: target }).eq('id', mine);
        if (error && !isFrozen(error)) throw error;
      }
      return;
    }
    target = row.superseded_by as string;
  }
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
    case 'day_photo': {
      // A progress photo from the crew (README R172): the file to the job's folder for the day, then the row that
      // names it — once, however many times the phone retries. The review screen takes it from there.
      const blob = blobs.photo;
      if (!blob) throw Object.assign(new Error('The photo was lost from this phone. Take it again.'), { code: '42501' });
      const row = p.row as { url: string } & Record<string, unknown>;
      await uploadIfMissing(row.url, blob, (p.type as string | undefined) ?? 'image/jpeg');
      const { error } = await supabase.from('day_photos').insert(row);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'qa_record': {
      // An ITR or site form (README R164): the signatures first, then the record itself, upserted on its client-chosen
      // id — once, however many times the phone retries. The database checks every item, column and party.
      for (const sg of (p.sigs as Array<{ key: string; path: string }> | undefined) ?? []) {
        if (!blobs[sg.key]) throw Object.assign(new Error('A signature was lost from this phone. Ask them to sign again.'), { code: '42501' });
        await uploadIfMissing(sg.path, blobs[sg.key], 'image/png');
      }
      for (const f of (p.files as Array<{ key: string; path: string; type: string }> | undefined) ?? []) {
        if (blobs[f.key]) await uploadIfMissing(f.path, blobs[f.key], f.type);
      }
      const { error } = await supabase.from('qa_records').upsert(p.row as Record<string, unknown>, { onConflict: 'id' });
      if (error && !isFrozen(error)) throw error;
      return;
    }
    case 'qa_record_photos': {
      // Photographs on a SIGNED record (README R176, R189): the files first, then added to whatever the record holds by
      // now, and the ones marked for removal taken off — the database keeps the signed-with ones first and refuses
      // anything else changing.
      const files = (p.files as Array<{ key: string; path: string; type: string }> | undefined) ?? [];
      for (const f of files) {
        if (!blobs[f.key]) throw Object.assign(new Error('A photograph was lost from this phone. Take it again.'), { code: '42501' });
        await uploadIfMissing(f.path, blobs[f.key], f.type);
      }
      await changeQaPhotos(createClient(), item.subjectId, { add: files.map((f) => f.path), remove: (p.remove as string[] | undefined) ?? [] });
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
        typed_name: (p.typedName as string | undefined) ?? null, time_on_page_s: (p.timeOnPage as number | undefined) ?? null, quiz_attempt_id: (p.attemptId as string | undefined) ?? null,
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
    case 'hazard_control': {
      // A control put down with no signal (README R179); the database stamps when it went in.
      const { error } = await supabase.from('hazard_controls').insert({ id: p.id as string, ...(p.row as Record<string, unknown>) });
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'hazard_control_update': {
      // In place, or withdrawn with a reason. A control frozen in the meantime (withdrawn, or on a closed report) is left as it is.
      const { data, error } = await supabase.from('hazard_controls').update(p.patch as Record<string, unknown>).eq('id', p.controlId as string).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        const { data: row } = await supabase.from('hazard_controls').select('status').eq('id', p.controlId as string).maybeSingle();
        if (!row) throw Object.assign(new Error('That control no longer exists.'), { code: '42501' });
        if (row.status === 'planned') throw Object.assign(new Error('The control could not be moved from this account.'), { code: '42501' });
      }
      return;
    }
    case 'form_save': {
      // A form being filled with no signal (README R180): the photographs first, then the row upserted on its
      // phone-chosen id — the database copies the template on the first save and keeps it from then on. A form
      // completed or voided in the meantime is left as it is.
      for (const f of (p.files as Array<{ key: string; path: string; type: string }> | undefined) ?? []) {
        if (blobs[f.key]) await uploadIfMissing(f.path, blobs[f.key], f.type);
      }
      const { error } = await supabase.from('form_submissions').upsert({ id: item.subjectId, project_id: item.projectId, ...(p.row as Record<string, unknown>) }, { onConflict: 'id' });
      if (error && !isFrozen(error)) throw error;
      return;
    }
    case 'form_complete': {
      // The same save with the signature and status = completed: the database checks every rule and freezes it.
      // The open row is upserted first (it may never have reached the server), then the completion is a plain
      // UPDATE — an upsert's EXCLUDED row has already been forced open by the before-insert trigger, and the
      // completion would land silently as open.
      const rowIn = p.row as Record<string, unknown>;
      const { error: e0 } = await supabase.from('form_submissions').upsert({ id: item.subjectId, project_id: item.projectId, ...rowIn, status: 'open', signature_path: null, completed_on_device_at: null }, { onConflict: 'id' });
      if (e0 && !isFrozen(e0)) throw e0;
      for (const f of (p.files as Array<{ key: string; path: string; type: string }> | undefined) ?? []) {
        if (blobs[f.key]) await uploadIfMissing(f.path, blobs[f.key], f.type);
      }
      if (p.sigPath) {
        if (!blobs.signature) throw Object.assign(new Error('The signature was lost from this phone. Ask them to sign again.'), { code: '42501' });
        await uploadIfMissing(p.sigPath as string, blobs.signature, 'image/png');
      }
      const { error } = await supabase.from('form_submissions').update(rowIn).eq('id', item.subjectId);
      if (error && !isFrozen(error)) throw error;
      return;
    }
    case 'form_nc_update': {
      // Resolved, raised as an action, or removed with a reason. One frozen in the meantime is left as it is.
      const { data, error } = await supabase.from('form_non_compliances').update(p.patch as Record<string, unknown>).eq('id', p.ncId as string).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        const { data: row } = await supabase.from('form_non_compliances').select('status').eq('id', p.ncId as string).maybeSingle();
        if (!row) throw Object.assign(new Error('That non-compliance no longer exists.'), { code: '42501' });
        if (row.status === 'open') throw Object.assign(new Error('The non-compliance could not be changed from this account.'), { code: '42501' });
      }
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
      await fetch(`/api/orders/${item.subjectId}/notify`, { method: 'POST' }).catch(() => undefined);
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
    case 'delivery_book': {
      // A booking made with no signal (README R127): the id is the phone's, so a replay meets its own row and stops.
      const { error } = await supabase.from('deliveries').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'delivery_update': {
      // Received, moved or cancelled with no signal. One already finished by someone else is frozen: done is done.
      const { data, error } = await supabase.from('deliveries').update(p.patch as Record<string, unknown>).eq('id', item.subjectId).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        const { data: row } = await supabase.from('deliveries').select('status').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That delivery no longer exists.'), { code: '42501' });
        if (row.status === 'booked') throw Object.assign(new Error('The delivery could not be changed from this account; it is still booked.'), { code: '42501' });
      }
      return;
    }
    case 'asset_checkout': {
      // Custody taken with no signal (README R186): the id is the phone's, so a replay meets its own row and stops.
      // A second open custody on the same asset is refused by the one-open index — someone else took it first,
      // and that is an answer, not a retry.
      const { error } = await supabase.from('asset_checkouts').insert(p.row as Record<string, unknown>);
      if (error && /asset_checkouts_one_open/i.test(error.message)) throw Object.assign(new Error('Someone else checked this asset out first. Find it on the register.'), { code: '42501' });
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'asset_checkin': {
      // Returned with no signal. Already returned by someone else: frozen, done is done.
      const { data, error } = await supabase.from('asset_checkouts').update(p.patch as Record<string, unknown>).eq('id', item.subjectId).is('in_at', null).select('id');
      if (error && !isFrozen(error)) throw error;
      if (!error && (!data || data.length === 0)) {
        const { data: row } = await supabase.from('asset_checkouts').select('in_at').eq('id', item.subjectId).maybeSingle();
        if (!row) throw Object.assign(new Error('That custody record no longer exists.'), { code: '42501' });
        if (row.in_at == null) throw Object.assign(new Error('The asset could not be checked in from this account.'), { code: '42501' });
      }
      return;
    }
    case 'asset_meter': {
      // A reading taken with no signal: the phone's id, so a replay stops at its own row. A reading the meter
      // has since passed is refused by the database as a lower one — that is a real answer, not a retry.
      const { error } = await supabase.from('asset_meter_readings').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'dayworks_approval': {
      // The client's signature on the screen (README R125): the drawn signature first, then the row that names it.
      // The row's id is the phone's, so a replay after a dropped reply meets its own row and stops.
      if (!blobs.signature) throw Object.assign(new Error('The signature was lost from this phone. Ask them to sign again.'), { code: '42501' });
      await uploadIfMissing(p.path as string, blobs.signature, 'image/png', 'dayworks-signoffs');
      const { error } = await supabase.from('dayworks_signoffs').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      return;
    }
    case 'hc_document': {
      // The copy first, then the row that names it, then the older copy marked superseded.
      if (p.path && !blobs.file) {
        // Never write a row naming a file that was not kept on the phone.
        throw Object.assign(new Error('The attached copy was lost from this phone. Record the plan again with its file.'), { code: '42501' });
      }
      if (p.path && blobs.file) await uploadIfMissing(p.path as string, blobs.file, (p.contentType as string) ?? 'application/pdf', 'head-contractor-docs');
      const { error } = await supabase.from('head_contractor_documents').insert(p.row as Record<string, unknown>);
      if (error && !isAlreadyDone(error)) throw error;
      if (p.supersedes) await supersedeChain(p.supersedes as string, item.subjectId, (p.row as { received_on: string }).received_on);
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
