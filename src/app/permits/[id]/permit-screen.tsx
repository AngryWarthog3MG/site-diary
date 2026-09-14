'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { fmtDate } from '@/lib/pdf/dates';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { awstClock } from '@/lib/signin/register';
import { KIND_LABEL, STATUS_LABEL, permitRef, expired, live, closeoutFor, allAnswered, type Control, type ControlResult, type PermitKind, type PermitStatus } from '@/lib/permits/model';

export interface PermitView {
  id: string; projectId: string; seq: number; kind: PermitKind; title: string; location: string | null; valid_from: string; valid_to: string;
  swms: string | null; swms_id: string | null; plant: string | null; workers: string[]; controls: Control[]; conditions: string | null;
  issuer_name: string; holder_name: string; issuer_signature_path: string | null; holder_signature_path: string | null; issued_at: string | null; issued_on_device_at: string | null;
  status: PermitStatus; closeout_checks: Control[] | null; closeout_note: string | null; closeout_signature_path: string | null; closed_at: string | null; closed_on_device_at: string | null;
  cancel_reason: string | null; issued_by: string;
}
interface Props { permit: PermitView; canManage: boolean; userId: string }

export function PermitScreen({ permit: p, canManage, userId }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Control[]>(closeoutFor(p.kind));
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);
  const nowIso = new Date().toISOString();
  const isLive = live(p, nowIso); const isExpired = expired(p, nowIso);

  useEffect(() => {
    const paths = [p.issuer_signature_path, p.holder_signature_path, p.closeout_signature_path].filter((x): x is string => Boolean(x));
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('entry-photos').createSignedUrls(paths, 3600);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [p.issuer_signature_path, p.holder_signature_path, p.closeout_signature_path]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const closeOut = (sig: Blob) => run('close the permit', async () => {
    if (!allAnswered(checks)) throw new Error('Answer every close-out check.');
    const at = new Date().toISOString();
    const sigPath = `${p.projectId}/permit/${p.id}/closeout-${outbox.newId()}.png`;
    const live_ = async () => {
      const supabase = createClient();
      const { error: e } = await supabase.storage.from('entry-photos').upload(sigPath, sig, { contentType: 'image/png', upsert: false });
      if (e) throw new Error(e.message);
      const { data, error: upErr } = await supabase.from('permits').update({ status: 'closed', closeout_checks: checks, closeout_note: note.trim() || null, closeout_signature_path: sigPath, closed_on_device_at: at }).eq('id', p.id).select('id');
      if (upErr) throw new Error(upErr.message);
      if (!data || data.length === 0) throw new Error('Not allowed from this account, or already closed.');
    };
    const queue = () => outbox.enqueue({ kind: 'permit_close', projectId: p.projectId, subjectId: p.id, payload: { checks, note: note.trim() || null, sigPath, at }, blobs: { signature: sig } }).then(() => undefined);
    const outcome = await runOrQueue(live_, queue);
    if (outcome !== 'sent') router.push(`/permits?project=${p.projectId}`);
  });
  const cancel = (reason: string) => run('cancel the permit', async () => {
    if (!reason.trim()) throw new Error('Say why.');
    if (!window.confirm('Cancel this permit? Work under it must stop. This cannot be undone.')) return;
    const { data, error: e } = await createClient().from('permits').update({ status: 'cancelled', cancel_reason: reason.trim() }).eq('id', p.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
  });
  const deleteOpen = () => run('delete it', async () => {
    if (!window.confirm('Delete this unissued permit?')) return;
    const { data, error: e } = await createClient().from('permits').delete().eq('id', p.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
    router.push(`/permits?project=${p.projectId}`);
  });
  const pdf = () => run('make the PDF', async () => {
    const res = await fetch(`/api/permits/${p.id}/pdf`, { method: 'POST' });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The PDF could not be made.');
    window.open(body.url, '_blank', 'noopener');
  });
  const sig = (path: string | null, who: string, when: string | null) => path && (
    <div className="talk-attendee">
      {urls[path] ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={urls[path]} alt="" />
      ) : <span className="talk-attendee__pending" />}
      <span>{who}{when ? <span className="caption"> · {when}</span> : null}</span>
    </div>
  );

  return (
    <section className="permit">
      <p className="label">{permitRef(p.seq)} · {KIND_LABEL[p.kind]}</p>
      <h1 className="page-title">{p.title}</h1>
      <p className={`page-subtitle ${isExpired ? 'vr-missing' : isLive ? 'swms__status--active' : ''}`}>
        {isExpired ? 'PAST ITS WINDOW — not closed out' : isLive ? 'Live now' : STATUS_LABEL[p.status]}
        {' · '}{fmtDate(p.valid_from.slice(0, 10))} {awstClock(p.valid_from)} to {p.valid_to.slice(0, 10) !== p.valid_from.slice(0, 10) ? `${fmtDate(p.valid_to.slice(0, 10))} ` : ''}{awstClock(p.valid_to)}
        {p.location ? ` · ${p.location}` : ''}
      </p>
      {p.status === 'open' && <p className="notice gap">This permit was saved but never issued — the signatures did not land. Raise it again, or delete this one.</p>}

      <div className="item">
        <p className="label">The permit</p>
        {p.swms && <p><span className="label">SWMS</span> {p.swms}</p>}
        {p.plant && <p><span className="label">Plant</span> {p.plant}</p>}
        <p><span className="label">Workers</span> {p.workers.length ? p.workers.join(', ') : '—'}</p>
        {p.conditions && <p><span className="label">Conditions</span> {p.conditions}</p>}
        <ul className="tri-list">
          {p.controls.map((c) => (
            <li key={c.key} className={`tri${c.result === 'yes' ? ' tri--ok' : c.result === 'na' ? ' tri--na' : ''}`}>
              <p className="tri__label">{c.label} <span className="mono caption">{c.result === 'yes' ? 'yes' : c.result === 'na' ? 'N/A' : 'not answered'}</span></p>
            </li>
          ))}
        </ul>
        {sig(p.issuer_signature_path, `Issued by ${p.issuer_name}`, p.issued_at ? finishedAtAwst(p.issued_at, p.issued_on_device_at) : null)}
        {sig(p.holder_signature_path, `Accepted by ${p.holder_name}`, null)}
      </div>

      {p.status === 'closed' && (
        <div className="item">
          <p className="label">Closed out</p>
          <ul className="tri-list">
            {(p.closeout_checks ?? []).map((c) => (
              <li key={c.key} className={`tri${c.result === 'yes' ? ' tri--ok' : ' tri--na'}`}><p className="tri__label">{c.label} <span className="mono caption">{c.result === 'yes' ? 'yes' : 'N/A'}</span></p></li>
            ))}
          </ul>
          {p.closeout_note && <p className="incident__text">{p.closeout_note}</p>}
          {sig(p.closeout_signature_path, 'Closed', p.closed_at ? finishedAtAwst(p.closed_at, p.closed_on_device_at) : null)}
        </div>
      )}
      {p.status === 'cancelled' && <div className="item"><p className="label">Cancelled</p><p className="incident__text">{p.cancel_reason}</p></div>}

      {p.status === 'issued' && canManage && !closing && (
        <div className="photo-add-pair">
          <button type="button" className="button" disabled={busy != null} onClick={() => setClosing(true)}>Close out</button>
          <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => { const r = window.prompt('Why is the permit cancelled?'); if (r) void cancel(r); }}>Cancel the permit</button>
        </div>
      )}
      {p.status === 'issued' && canManage && closing && (
        <div className="item">
          <p className="label">Close-out — every check answered</p>
          <ul className="tri-list">
            {checks.map((c) => (
              <li key={c.key} className={`tri${c.result === 'yes' ? ' tri--ok' : c.result === 'na' ? ' tri--na' : ''}`}>
                <p className="tri__label">{c.label}</p>
                <div className="tri__buttons permit-form__pair">
                  <button type="button" className={`tri__btn${c.result === 'yes' ? ' tri__btn--ok' : ''}`} onClick={() => setChecks(checks.map((x) => (x.key === c.key ? { ...x, result: 'yes' as ControlResult } : x)))}>Yes</button>
                  <button type="button" className={`tri__btn${c.result === 'na' ? ' tri__btn--na' : ''}`} onClick={() => setChecks(checks.map((x) => (x.key === c.key ? { ...x, result: 'na' as ControlResult } : x)))}>N/A</button>
                </div>
              </li>
            ))}
          </ul>
          <textarea className="field field--sm" rows={2} value={note} placeholder="Optional — anything to note at close-out" onChange={(e) => setNote(e.target.value)} />
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="sigslot"><p className="label">Sign the close-out</p><SignaturePad disabled={busy != null || !allAnswered(checks)} saving={busy === 'close the permit'} onSave={closeOut} /></div>
          <button type="button" className="linklike" onClick={() => setClosing(false)}>Not yet</button>
        </div>
      )}
      {p.status === 'open' && p.issued_by === userId && <button type="button" className="linklike" disabled={busy != null} onClick={() => void deleteOpen()}>Delete this unissued permit</button>}
      {error && !closing && <p className="alert" role="alert">{error}</p>}
      {p.status !== 'open' && <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void pdf()}>{busy === 'make the PDF' ? 'Making the PDF…' : 'Permit PDF'}</button>}
    </section>
  );
}
