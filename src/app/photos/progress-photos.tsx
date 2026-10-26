'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { OutboxStatus } from '@/components/outbox-status';
import { compressPhoto } from '@/lib/photos/compress';
import { photoTakenAt } from '@/lib/photos/taken-at';
import { dayPhotoPath, localDate } from '@/lib/photos/day';
import { fmtPerthDate } from '@/lib/pdf/dates';

export interface DayPhotoView { id: string; url: string; caption: string | null; takenAt: string | null; by: string | null; createdAt: string; signedUrl: string | null }

const BUCKET = 'entry-photos';

/**
 * Take or pick photographs; each is on the job the moment its upload lands — the row is written right after the
 * file, and nothing between the two can throw — or kept on the phone and sent when there is signal (outbox kind
 * `day_photo`). The caption typed goes on every photo of that pick. Nothing here edits or removes: a photograph taken
 * is kept; the supervisor decides what the day's record shows.
 */
export function ProgressPhotos({ projectId, today, photos, dayState, backTo }: {
  projectId: string; today: string; photos: DayPhotoView[]; dayState: 'none' | 'open' | 'signed'; backTo: string;
}) {
  const router = useRouter();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const queued = usePending('day_photo', projectId, 'project');

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true); setError(null); setDone(null);
    const takenOn = localDate();
    let sent = 0; let kept = 0;
    try {
      for (const file of Array.from(files)) {
        const photo = await compressPhoto(file);
        const id = crypto.randomUUID();
        const url = dayPhotoPath(projectId, takenOn, id, photo.extension);
        const row = { id, project_id: projectId, taken_on: takenOn, url, caption: caption.trim() || null, taken_at: photoTakenAt(file), added_on_device_at: new Date().toISOString() };
        setPreviews((p) => [...p, URL.createObjectURL(photo.blob)]);
        const live = async () => {
          const supabase = createClient();
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(url, photo.blob, { contentType: photo.contentType, upsert: false });
          if (upErr && !/already exists|duplicate/i.test(upErr.message)) throw new Error(upErr.message);
          const { error: rowErr } = await supabase.from('day_photos').insert(row);
          if (rowErr && !/duplicate key|already exists/i.test(rowErr.message)) throw new Error(/row-level security/i.test(rowErr.message) ? 'Your access on this job does not include photos.' : rowErr.message);
        };
        const queue = () => outbox.enqueue({ kind: 'day_photo', projectId, subjectId: id, payload: { row, type: photo.contentType }, blobs: { photo: photo.blob } }).then(() => undefined);
        const outcome = await runOrQueue(live, queue);
        if (outcome === 'sent') sent += 1; else kept += 1;
      }
      setCaption('');
      setDone(sent && !kept ? `${sent} photo${sent === 1 ? '' : 's'} on today’s job.` : kept && !sent ? `${kept} photo${kept === 1 ? '' : 's'} kept on this phone — sent when there is signal.` : `${sent} sent, ${kept} kept on this phone until there is signal.`);
      // A save kept on the phone never refreshes the page (README R78).
      if (sent && !kept) { setPreviews([]); router.refresh(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo did not save.');
    } finally { setBusy(false); }
  }

  return (
    <div className="qa-edit">
      <OutboxStatus />
      <section className="qa-section">
        <p className="label">Add photos · {fmtPerthDate(today)}</p>
        <label className="fieldcell"><span className="label">What they show · optional</span>
          <input className="field field--sm" value={caption} placeholder="Where, and what — e.g. Zone 3 subgrade proof rolled" onChange={(e) => setCaption(e.target.value)} disabled={busy} /></label>
        <div className="photo-add-pair" style={{ marginTop: '0.5rem' }}>
          <label className={`button${busy ? ' button--quiet' : ''}`}>
            {busy ? 'Saving…' : 'Take a photo'}
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          </label>
          <label className="button button--quiet">
            From the gallery
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        {previews.length > 0 && (
          <div className="qa-item__photos" style={{ marginTop: '0.5rem' }}>
            {previews.map((src) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={src} className="qa-photo qa-photo--new" src={src} alt="" />)}
          </div>
        )}
        {done && <p className="caption">{done}</p>}
        {error && <p className="alert">{error}</p>}
        {queued.length > 0 && <p className="caption">{queued.length} photo{queued.length === 1 ? '' : 's'} waiting on this phone for signal.</p>}
        <p className="caption">
          {dayState === 'open' ? 'Today’s diary is open: each photo joins it the next time the supervisor’s screen looks, within a minute.'
            : dayState === 'signed' ? 'Today’s diary is already signed. The photos are kept on the job; the supervisor can put them on a correction.'
              : 'Today’s diary has not been started yet. The photos wait on the job and join it when it is.'}
        </p>
      </section>

      <section className="qa-section">
        <p className="label">Today so far · {photos.length}</p>
        {photos.length === 0 ? <p className="caption">No photos yet today.</p> : (
          <div className="qa-item__photos">
            {photos.map((p) => (
              <figure key={p.id} style={{ margin: 0 }}>
                {p.signedUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="qa-photo" src={p.signedUrl} alt={p.caption ?? ''} /> : <span className="qa-photo qa-photo--pending" />}
                <figcaption className="caption" style={{ margin: '0.15rem 0 0' }}>{p.caption ?? '—'}{p.by ? ` · ${p.by}` : ''}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
      <Link className="button button--quiet" href={backTo}>Back to Home</Link>
      <p className="caption">Photos are never removed from here. The record of the day is what the supervisor signs.</p>
    </div>
  );
}
