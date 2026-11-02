'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { compressPhoto } from '@/lib/photos/compress';
import { SignaturePad } from '@/components/signature-pad';
import { Fold } from '@/components/fold';
import {
  answered, answerFails, completionProblems, score, failing, questions as allQuestions,
  type FormSpec, type Answers, type Answer, type Question, type FormSubject, type SignatureRule,
} from '@/lib/forms/model';

export interface FillProps {
  submissionId: string;
  projectId: string;
  userId: string;
  /** The template as the form will copy it (a new one) or as the open submission holds it. */
  templateId: string;
  code: string;
  title: string;
  revision: string;
  spec: FormSpec;
  passMark: number | null;
  signatureRule: SignatureRule;
  subject: FormSubject;
  basis: string | null;
  initial: { answers: Answers; header: Record<string, unknown>; subjectPlantId: string | null; subjectPerson: string | null };
  machines: Array<{ id: string; name: string }>;
  people: string[];
  isNew: boolean;
}
interface Photo { blob: Blob; type: string; ext: string; preview: string; path: string }

/**
 * Filling a form (README R180): one screen, big answer buttons, a photograph on a failing answer where the form
 * asks for one, the signature at the end. Saved as it goes — every answer upserts the row through the outbox on
 * a phone-chosen id, so a half-filled form survives a reload with no signal — and completed only whole, which
 * the database checks again. Nothing is on the record until it is completed.
 */
export function FormFill(p: FillProps) {
  const router = useRouter();
  const pendingSaves = usePending('form_save', p.submissionId);
  const pendingDone = usePending('form_complete', p.submissionId);
  const [answers, setAnswers] = useState<Answers>(p.initial.answers);
  const [header, setHeader] = useState<Record<string, unknown>>(p.initial.header);
  const [plantId, setPlantId] = useState<string | null>(p.initial.subjectPlantId);
  const [person, setPerson] = useState(p.initial.subjectPerson ?? '');
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(p.isNew ? null : 'sent');
  const [dirty, setDirty] = useState(false);
  const qs = useMemo(() => allQuestions(p.spec), [p.spec]);
  const folder = `${p.projectId}/form/${p.submissionId}`;

  const fullAnswers = (): Answers => {
    const out: Answers = {};
    for (const q of qs) {
      const a = answers[q.key] ?? {};
      const paths = [...(a.photo_paths ?? []), ...(photos[q.key] ?? []).map((ph) => ph.path)];
      out[q.key] = { value: a.value, note: a.note ?? null, ...(paths.length ? { photo_paths: paths } : {}) };
    }
    return out;
  };
  const problems = completionProblems(p.spec, fullAnswers(), { subject: p.subject, subjectPlantId: plantId, subjectPerson: person, signatureRule: p.signatureRule, hasSignature: true });
  const liveScore = score(p.spec, fullAnswers());
  const fails = failing(p.spec, fullAnswers());
  const done = qs.filter((q) => answered(q, fullAnswers()[q.key])).length;

  const set = (key: string, patch: Partial<Answer>) => { setAnswers((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } })); setDirty(true); };

  async function addPhoto(key: string, files: FileList | null) {
    if (!files) return;
    try {
      const next: Photo[] = [];
      for (const f of Array.from(files)) {
        const c = await compressPhoto(f);
        next.push({ blob: c.blob, type: c.contentType, ext: c.extension, preview: URL.createObjectURL(c.blob), path: `${folder}/${outbox.newId()}.${c.extension}` });
      }
      setPhotos((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...next] }));
      setDirty(true);
    } catch (err) { setError(err instanceof Error ? `Photo could not be read: ${err.message}` : 'Photo could not be read.'); }
  }

  const row = (status: 'open' | 'completed', sigPath: string | null, at: string) => ({
    template_id: p.templateId, started_by: p.userId, header, answers: fullAnswers(),
    subject_plant_id: p.subject === 'plant' ? plantId : null, subject_person: p.subject === 'person' ? (person.trim() || null) : null,
    status, ...(status === 'completed' ? { signature_path: sigPath, completed_on_device_at: at } : {}),
  });
  const files = () => Object.values(photos).flat().map((ph) => ({ key: ph.path, path: ph.path, type: ph.type, blob: ph.blob }));

  async function save(kind: 'form_save' | 'form_complete', sig: Blob | null) {
    setBusy(kind); setError(null);
    const at = new Date().toISOString();
    const sigPath = sig ? `${folder}/sig-${outbox.newId()}.png` : null;
    const r = row(kind === 'form_complete' ? 'completed' : 'open', sigPath, at);
    const fs = files();
    try {
      const live = async () => {
        const supabase = createClient();
        // The row first on a new form, so the storage policy can see whose folder this is; then the files; then the row again with them.
        if (p.isNew || kind === 'form_save') {
          const { error: e0 } = await supabase.from('form_submissions').upsert({ id: p.submissionId, project_id: p.projectId, ...row('open', null, at) }, { onConflict: 'id' });
          if (e0) throw new Error(e0.message);
        }
        for (const f of fs) {
          const { error: e } = await supabase.storage.from('entry-photos').upload(f.path, f.blob, { contentType: f.type, upsert: false });
          if (e && !/exists|duplicate/i.test(e.message)) throw new Error(e.message);
        }
        if (sig && sigPath) {
          const { error: e } = await supabase.storage.from('entry-photos').upload(sigPath, sig, { contentType: 'image/png', upsert: false });
          if (e) throw new Error(e.message);
        }
        const { data, error: e1 } = await supabase.from('form_submissions').upsert({ id: p.submissionId, project_id: p.projectId, ...r }, { onConflict: 'id' }).select('status');
        if (e1) throw new Error(e1.message);
        if (kind === 'form_complete' && (!data || data[0]?.status !== 'completed')) throw new Error('The form was saved but could not be completed from this account.');
      };
      const queue = () => outbox.enqueue({
        kind, projectId: p.projectId, subjectId: p.submissionId,
        payload: { row: r, ...(sigPath ? { sigPath } : {}), files: fs.map(({ key, path, type }) => ({ key, path, type })) },
        blobs: { ...(sig ? { signature: sig } : {}), ...Object.fromEntries(fs.map((f) => [f.key, f.blob])) },
      }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setSaved(outcome); setDirty(false);
      if (kind === 'form_complete') {
        // A save kept on the phone never refreshes the page (README R78); a sent one goes to the record.
        router.push(outcome === 'sent' ? `/forms/${p.submissionId}?project=${p.projectId}` : `/forms?project=${p.projectId}`);
        return;
      }
      if (p.isNew && outcome === 'sent') router.replace(`/forms/fill/${p.submissionId}?project=${p.projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The form did not save.');
    } finally { setBusy(null); }
  }

  const complete = (sig: Blob | null) => {
    if (problems.length > 0) { setError(`Not yet: ${problems.join(' ')}`); return; }
    void save('form_complete', sig);
  };

  const choice = (q: Question, opts: Array<[string, string, 'ok' | 'defect' | 'na' | undefined]>) => {
    const v = answers[q.key]?.value;
    return (
      <div className="tri__buttons" style={{ gridTemplateColumns: `repeat(${opts.length}, 1fr)` }}>
        {opts.map(([val, label, tone]) => (
          <button key={val} type="button" className={`tri__btn${v === val && tone ? ` tri__btn--${tone} is-on` : v === val ? ' tri__btn--ok is-on' : ''}`} onClick={() => set(q.key, { value: val })}>{label}</button>
        ))}
      </div>
    );
  };
  const control = (q: Question) => {
    const a = answers[q.key];
    switch (q.type) {
      case 'yes_no': return choice(q, [['yes', 'Yes', (q.fail ?? 'no') === 'yes' ? 'defect' : 'ok'], ['no', 'No', (q.fail ?? 'no') === 'no' ? 'defect' : 'ok']]);
      case 'ok_issue_na': return choice(q, [['ok', 'OK', 'ok'], ['issue', 'Issue', 'defect'], ['na', 'N/A', 'na']]);
      case 'pass_fail': return choice(q, [['pass', 'Pass', 'ok'], ['fail', 'Fail', 'defect']]);
      case 'score': {
        const mx = q.max ?? 5;
        const vals = Array.from({ length: mx <= 10 ? mx + 1 : 11 }, (_, i) => (mx <= 10 ? i : Math.round((i * mx) / 10)));
        return choice(q, vals.map((n) => [String(n), String(n), q.fail != null && n < Number(q.fail) ? 'defect' : 'ok']));
      }
      case 'number': return (
        <input className="field field--sm" type="number" inputMode="decimal" step="any" value={a?.value == null ? '' : String(a.value)} placeholder={q.unit ?? ''} onChange={(e) => set(q.key, { value: e.target.value === '' ? null : Number(e.target.value) })} />
      );
      case 'select': return (
        <select className="field field--sm" value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value || null })}>
          <option value="">—</option>{(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      case 'multi': {
        const vs = Array.isArray(a?.value) ? (a.value as string[]) : [];
        return (
          <div className="crewchips">
            {(q.options ?? []).map((o) => (
              <button key={o} type="button" className={`chip${vs.includes(o) ? ' chip--on' : ''}`} onClick={() => set(q.key, { value: vs.includes(o) ? vs.filter((x) => x !== o) : [...vs, o] })}>{o}</button>
            ))}
          </div>
        );
      }
      case 'text': return <textarea className="field field--sm" rows={2} value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value })} />;
      case 'date': return <input className="field field--sm" type="date" value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value || null })} />;
      case 'time': return <input className="field field--sm" type="time" value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value || null })} />;
      case 'person': return (
        <><input className="field field--sm" list={`people-${q.key}`} value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value })} />
          <datalist id={`people-${q.key}`}>{p.people.map((n) => <option key={n} value={n} />)}</datalist></>
      );
      case 'plant': return (
        <select className="field field--sm" value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value || null })}>
          <option value="">—</option>{p.machines.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      );
      case 'photo': return null;
      case 'signature': return <input className="field field--sm" placeholder="Name of who signs" value={typeof a?.value === 'string' ? a.value : ''} onChange={(e) => set(q.key, { value: e.target.value })} />;
      default: return null;
    }
  };

  const photoBlock = (q: Question) => {
    const kept = answers[q.key]?.photo_paths ?? [];
    const mine = photos[q.key] ?? [];
    return (
      <div className="tri__defect" style={{ gridTemplateColumns: '1fr' }}>
        <div className="photo-add-pair">
          <label className="button button--quiet" style={{ marginTop: 0 }}>Photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addPhoto(q.key, e.target.files)} /></label>
          <label className="button button--quiet" style={{ marginTop: 0 }}>From phone<input type="file" accept="image/*" multiple hidden onChange={(e) => void addPhoto(q.key, e.target.files)} /></label>
          {kept.length > 0 && <span className="caption">{kept.length} already saved</span>}
        </div>
        {mine.length > 0 && (
          <div className="photos__grid report-form__photos">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mine.map((ph) => <figure key={ph.path}><img src={ph.preview} alt="" /></figure>)}
          </div>
        )}
      </div>
    );
  };

  const pending = pendingSaves.length + pendingDone.length;
  return (
    <div className="formfill">
      <p className="page-subtitle"><strong>{p.code} rev {p.revision}</strong>{p.basis ? ` · ${p.basis}` : ''}</p>
      {pending > 0 && <p className="notice">Waiting to send from this phone: {pending} save{pending === 1 ? '' : 's'}.</p>}

      {(p.spec.header.length > 0 || p.subject !== 'none') && (
        <div className="item">
          <div className="signin__grid">
            {p.subject === 'plant' && (
              <label className="fieldcell"><span className="label">Machine</span>
                <select className="field field--sm" value={plantId ?? ''} onChange={(e) => { setPlantId(e.target.value || null); setDirty(true); }}>
                  <option value="">Which machine</option>{p.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
            )}
            {p.subject === 'person' && (
              <label className="fieldcell"><span className="label">About</span>
                <input className="field field--sm" list="form-people" value={person} placeholder="Their name on the sheets" onChange={(e) => { setPerson(e.target.value); setDirty(true); }} />
                <datalist id="form-people">{p.people.map((n) => <option key={n} value={n} />)}</datalist></label>
            )}
            {p.spec.header.map((h) => (
              <label key={h.key} className="fieldcell"><span className="label">{h.label}</span>
                {h.type === 'select' ? (
                  <select className="field field--sm" value={typeof header[h.key] === 'string' ? (header[h.key] as string) : ''} onChange={(e) => { setHeader({ ...header, [h.key]: e.target.value || null }); setDirty(true); }}>
                    <option value="">—</option>{(h.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="field field--sm" type={h.type === 'number' ? 'number' : h.type === 'date' ? 'date' : 'text'} value={header[h.key] == null ? '' : String(header[h.key])}
                    onChange={(e) => { setHeader({ ...header, [h.key]: e.target.value === '' ? null : h.type === 'number' ? Number(e.target.value) : e.target.value }); setDirty(true); }} />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {p.spec.sections.map((s, si) => {
        const body = (
          <ul className="tri-list">
            {s.questions.map((q) => {
              const a = fullAnswers()[q.key];
              const isAnswered = answered(q, a);
              const fail = answerFails(q, a);
              return (
                <li key={q.key} className={`tri${fail ? ' tri--defect' : isAnswered ? ' tri--ok' : ''}`}>
                  <p className="tri__label">{q.label}{q.required ? ' *' : ''}{q.help ? <span className="caption"> — {q.help}</span> : null}</p>
                  {control(q)}
                  {(fail || q.type === 'photo') && (
                    <>
                      {fail && <textarea className="field field--sm" rows={2} placeholder="What is wrong, and where" value={answers[q.key]?.note ?? ''} onChange={(e) => set(q.key, { note: e.target.value })} style={{ marginTop: '0.4rem' }} />}
                      {photoBlock(q)}
                      {fail && q.raise_action && <p className="caption vr-missing">This answer raises an action when the form is completed.</p>}
                      {fail && q.photo_required && (answers[q.key]?.photo_paths ?? []).length + (photos[q.key] ?? []).length === 0 && <p className="caption vr-missing">A photograph is needed on this answer.</p>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        );
        return p.spec.sections.length > 1 ? <Fold key={si} label={s.title} count={s.questions.length} phoneOnly>{body}</Fold> : <div key={si} className="item"><p className="label">{s.title}</p>{body}</div>;
      })}

      <p className="caption">
        {done} of {qs.length} answered{liveScore != null ? ` · score ${liveScore}%${p.passMark != null ? ` (pass mark ${p.passMark}%)` : ''}` : ''}{fails.length > 0 ? ` · ${fails.length} failing` : ''}.
        {saved === 'queued' ? ' Saved on this phone; it sends when there is signal.' : saved === 'sent' && !dirty ? ' Saved.' : dirty ? ' Not saved yet.' : ''}
      </p>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="photo-add-pair">
        <button type="button" className="button button--quiet" disabled={busy != null || !dirty} onClick={() => void save('form_save', null)}>{busy === 'form_save' ? 'Saving…' : 'Save for later'}</button>
        <Link className="linklike" href={`/forms?project=${p.projectId}`}>Back to forms</Link>
      </div>
      {problems.length > 0 && <p className="caption">To complete: {problems.join(' ')}</p>}
      {p.signatureRule === 'none' ? (
        <button type="button" className="button" disabled={busy != null || problems.length > 0} onClick={() => complete(null)}>{busy === 'form_complete' ? 'Completing…' : 'Complete the form'}</button>
      ) : (
        <div className="sigslot item">
          <p className="label">Sign to complete{p.signatureRule === 'optional' ? ' (or complete without signing)' : ''}</p>
          <SignaturePad disabled={busy != null || problems.length > 0} saving={busy === 'form_complete'} onSave={(blob) => complete(blob)} />
          {p.signatureRule === 'optional' && <button type="button" className="linklike" disabled={busy != null || problems.length > 0} onClick={() => complete(null)}>Complete without signing</button>}
        </div>
      )}
    </div>
  );
}
