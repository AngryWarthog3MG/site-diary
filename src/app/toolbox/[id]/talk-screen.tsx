'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/brand-mark';
import { SignaturePad } from '@/components/signature-pad';

/**
 * The talk itself. While open: the phone goes around the crew — name, sign,
 * next. Complete freezes it (database-enforced) and unlocks the PDF.
 */
export function TalkScreen({
  talk,
  attendees,
  canRun,
  projectName,
}: {
  talk: {
    id: string;
    projectId: string;
    date: string;
    topic: string;
    summary: string;
    presenter: string;
    completed: boolean;
  };
  attendees: Array<{ id: string; attendee_name: string; signature_path: string }>;
  canRun: boolean;
  projectName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (attendees.length === 0) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('entry-photos')
        .createSignedUrls(attendees.map((a) => a.signature_path), 3600);
      if (!cancelled) {
        const next: Record<string, string> = {};
        for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
        setUrls(next);
      }
    })();
    return () => { cancelled = true; };
  }, [attendees]);

  async function addAttendee(blob: Blob) {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name first, then sign.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `${talk.projectId}/toolbox/${talk.id}/sig-${crypto.randomUUID()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('entry-photos')
        .upload(path, blob, { contentType: 'image/png', upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { error: insertError } = await supabase
        .from('toolbox_attendees')
        .insert({ talk_id: talk.id, attendee_name: trimmed, signature_path: path });
      if (insertError) throw new Error(insertError.message);
      setName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-on did not save.');
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    setCompleting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('toolbox_talks')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', talk.id);
      if (updateError) throw new Error(updateError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the talk.');
    } finally {
      setCompleting(false);
    }
  }

  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/toolbox/${talk.id}/pdf`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        setError(json?.error?.message ?? 'The PDF could not be generated.');
        return;
      }
      window.open(json.url as string, '_blank', 'noopener');
    } catch {
      setError('No signal — try again when you are back in range.');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {projectName}
      </p>
      <h1 className="page-title">{talk.topic}</h1>
      <p className="mono page-subtitle">
        {talk.date} · presented by {talk.presenter}
        {talk.completed ? ' · COMPLETED' : ''}
      </p>
      <hr className="rule" />
      <p className="label">What was covered</p>
      <p className="notes" style={{ whiteSpace: 'pre-wrap' }}>{talk.summary}</p>

      <hr className="rule" />
      <p className="label">Sign-on · {attendees.length}</p>
      {attendees.map((a) => (
        <div key={a.id} className="talk-attendee">
          {urls[a.signature_path] ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={urls[a.signature_path]} alt="" />
          ) : (
            <span className="talk-attendee__pending" />
          )}
          <span>{a.attendee_name}</span>
        </div>
      ))}

      {!talk.completed && canRun && (
        <div className="sigslot item" style={{ marginTop: '1rem' }}>
          <p className="label">Add attendee — hand them the phone</p>
          <label className="fieldcell">
            <span className="label">Name</span>
            <input className="field field--sm" value={name} placeholder="Kel Brady"
              onChange={(e) => setName(e.target.value)} />
          </label>
          <SignaturePad saving={saving} onSave={addAttendee} />
        </div>
      )}

      {error && <p className="alert">{error}</p>}

      {!talk.completed && canRun && (
        <button className="button" type="button" disabled={completing || attendees.length === 0} onClick={complete}>
          {completing ? 'Completing…' : `Complete the talk (${attendees.length} signed on)`}
        </button>
      )}
      {talk.completed && (
        <button className="button" type="button" disabled={pdfBusy} onClick={downloadPdf}>
          {pdfBusy ? 'Generating…' : 'Download the PDF'}
        </button>
      )}
      <Link className="button button--quiet" href={`/toolbox?project=${talk.projectId}`}>
        Back to talks
      </Link>
    </main>
  );
}
