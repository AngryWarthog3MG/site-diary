'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { answered, answerFails, answerText, type FormSpec, type Answers, type SubmissionStatus, type Outcome } from '@/lib/forms/model';
import { NcList, type NcView } from '../nc-list';

export interface SubmissionView {
  id: string; projectId: string; code: string; title: string; revision: string; spec: FormSpec; answers: Answers; header: Record<string, unknown>;
  status: SubmissionStatus; score: number | null; outcome: Outcome | null; passMark: number | null; subjectPerson: string | null; machine: string | null;
  startedBy: string; startedAt: string; completedBy: string | null; completedAt: string | null; completedOnDeviceAt: string | null; signaturePath: string | null;
  voidedAt: string | null; voidReason: string | null;
}
interface Props { s: SubmissionView; ncs: NcView[]; canAct: boolean; isOffice: boolean; today: string; userId: string }

/** A completed form as the record (README R180): frozen answers, its non-compliances, the PDF, and the office's void. */
export function SubmissionScreen({ s, ncs, canAct, isOffice, today, userId }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const paths = [...Object.values(s.answers).flatMap((a) => a.photo_paths ?? []), ...(s.signaturePath ? [s.signaturePath] : [])];

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const pdf = () => run('make the PDF', async () => {
    const res = await fetch(`/api/forms/${s.id}/pdf`, { method: 'POST' });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) throw new Error(body.error?.message ?? 'The PDF could not be made.');
    window.open(body.url, '_blank', 'noopener');
  });
  const doVoid = () => run('void the form', async () => {
    if (!voidReason.trim()) throw new Error('Say why.');
    const { data, error: e } = await createClient().from('form_submissions').update({ status: 'voided', void_reason: voidReason.trim() }).eq('id', s.id).select('id');
    if (e) throw new Error(e.message);
    if (!data || data.length === 0) throw new Error('Not allowed from this account.');
    setVoiding(false);
  });
  const q = `?project=${s.projectId}`;
  const completed = s.status !== 'open';

  return (
    <section className="inspection">
      <p className="label">{s.code} rev {s.revision}{s.subjectPerson ? ` · ${s.subjectPerson}` : ''}{s.machine ? ` · ${s.machine}` : ''}</p>
      <h1 className="page-title">{s.title}</h1>
      <p className={`page-subtitle${s.status === 'voided' ? ' vr-missing' : ''}`}>
        {s.status === 'voided' ? `VOIDED ${fmtPerthDate(s.voidedAt)} — ${s.voidReason ?? ''}. ` : ''}
        {completed ? `Completed by ${s.completedBy ?? 'someone'} · ${finishedAtAwst(s.completedAt as string, s.completedOnDeviceAt)}` : `Open — started ${fmtPerthDate(s.startedAt)} by ${s.startedBy}; nothing here is on the record yet`}
        {completed ? ` · ${s.outcome === 'fail' ? 'FAIL' : 'PASS'}${s.score != null ? ` · ${s.score}%${s.passMark != null ? ` (pass mark ${s.passMark}%)` : ''}` : ''}` : ''}
      </p>
      {!completed && <p><Link className="button" href={`/forms/fill/${s.id}${q}`}>Continue filling it</Link></p>}

      {Object.keys(s.header).length > 0 && (
        <div className="item"><p className="label">Header</p>
          <p className="caption">{s.spec.header.map((h) => `${h.label}: ${s.header[h.key] == null ? '—' : String(s.header[h.key])}`).join(' · ')}</p></div>
      )}
      {s.spec.sections.map((sec, i) => (
        <div key={i} className="item">
          <p className="label">{sec.title}</p>
          <ul className="tri-list tri-list--read">
            {sec.questions.map((qn) => {
              const a = s.answers[qn.key];
              const fail = answerFails(qn, a);
              const photos = a?.photo_paths ?? [];
              return (
                <li key={qn.key} className={`tri${fail ? ' tri--defect' : answered(qn, a) ? ' tri--ok' : ' tri--na'}`} style={{ display: 'block' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <p className="tri__label">{qn.label}</p>
                    <span className={`tri__result ${fail ? 'tri__result--defect' : answered(qn, a) ? 'tri__result--ok' : 'tri__result--na'}`}>{answerText(qn, a)}</span>
                  </div>
                  {a?.note && <p className="incident__text">{a.note}</p>}
                  {photos.length > 0 && (
                    <div className="photos__grid report-form__photos">
                      {photos.map((p) => (
                        <figure key={p}>{urls[p] ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <a href={urls[p]} target="_blank" rel="noopener"><img src={urls[p]} alt="" /></a>
                        ) : <span className="talk-attendee__pending" />}</figure>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {completed && (
        <div className="item">
          <p className="label">Non-compliances · {ncs.filter((n) => n.status === 'open').length} open</p>
          <NcList projectId={s.projectId} rows={ncs} canAct={canAct && s.status === 'completed'} isOffice={isOffice} today={today} />
        </div>
      )}

      {s.signaturePath && urls[s.signaturePath] && (
        <div className="talk-attendee">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[s.signaturePath]} alt="" /><span>{s.completedBy ?? ''}</span>
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
      {completed && (
        <div className="photo-add-pair">
          <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => void pdf()}>{busy === 'make the PDF' ? 'Making the PDF…' : 'Form PDF'}</button>
          {isOffice && s.status === 'completed' && !voiding && <button type="button" className="linklike" onClick={() => setVoiding(true)}>Void this form</button>}
        </div>
      )}
      {voiding && (
        <div className="actreg__edit">
          <input className="field field--sm" value={voidReason} placeholder="Why it is voided — it stays on the file, marked" onChange={(e) => setVoidReason(e.target.value)} />
          <div className="photo-add-pair">
            <button type="button" className="button button--quiet" style={{ marginTop: 0 }} disabled={busy != null || !voidReason.trim()} onClick={() => void doVoid()}>Void it</button>
            <button type="button" className="linklike" onClick={() => setVoiding(false)}>Cancel</button>
          </div>
        </div>
      )}
      <p className="caption" style={{ marginTop: '1rem' }}><Link href={`/forms${q}`}>Back to forms</Link>{userId === s.startedBy ? '' : ''}</p>
    </section>
  );
}
