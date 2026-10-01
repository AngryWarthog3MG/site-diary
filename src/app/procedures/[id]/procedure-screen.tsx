'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { SignaturePad } from '@/components/signature-pad';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { DUE_LABEL, KIND_LABEL, audienceText, coverage, dueState, normalisePerson, type ControlledKind, type QuestionFacts } from '@/lib/documents-control/model';
import type { AssignmentRow } from '@/lib/documents-control/load';
import { IssueForm } from '../new/issue-form';
import { QuestionsEditor } from '../new/questions-editor';

export interface Person { id: string; name: string; roles: string[]; jobs: string[] }

export interface ProcedureView {
  id: string; orgId: string; title: string; kind: ControlledKind; doc_number: string | null; requires_acknowledgement: boolean; active: boolean;
  audience: string[]; ack_due_days: number; review_interval_months: number | null; pass_mark: number | null;
  versions: Array<{
    id: string; version: number; file_path: string; summary: string | null; change_summary: string | null; status: string; issued_at: string | null; superseded_at: string | null;
    questions: QuestionFacts[];
    document_acknowledgements: Array<{ id: string; person_name: string; signature_path: string; acknowledged_on_device_at: string; project_id: string | null; recorded_by: string }>;
    assignments: AssignmentRow[];
  }>;
}
interface Props {
  doc: ProcedureView; projectId: string; crew: string[]; canManage: boolean; canSign: boolean; userId: string; myName: string | null;
  passedAttempt: string | null; people: Person[]; today: string;
}

/**
 * One document (README R120). For the person it binds: read it, pass the check
 * where there is one, type your name, sign — your own signature, closing your
 * own assignment. For the office: who has signed, who is overdue, remind,
 * waive, the draft waiting to be issued, and a new version.
 */
export function ProcedureScreen({ doc, projectId, crew, canManage, canSign, userId, myName, passedAttempt, people, today }: Props) {
  const router = useRouter();
  const current = doc.versions.find((v) => v.status === 'current') ?? null;
  const draft = doc.versions.find((v) => v.status === 'draft') ?? null;
  const mine = current?.assignments.find((a) => a.user_id === userId) ?? null;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const names = new Map(people.map((p) => [p.id, p]));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const files = doc.versions.filter((v) => v.status !== 'draft' || canManage).map((v) => v.file_path);
      if (files.length === 0) return;
      const { data } = await createClient().storage.from('controlled-docs').createSignedUrls(files, 3600);
      const next: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      if (!cancelled) setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [doc.versions, canManage]);

  async function post(path: string, body: unknown, key: string) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'That did not go.');
      setNotice(j.message ?? 'Done.');
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not go.'); } finally { setBusy(null); }
  }

  // ---- My own reading and signing ------------------------------------------------------------
  const openedAt = useRef<number>(Date.now());
  const [readToEnd, setReadToEnd] = useState(false);
  const [typed, setTyped] = useState('');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState<{ id: string; passed: boolean; score: number; total: number; passMark: number } | null>(passedAttempt ? { id: passedAttempt, passed: true, score: 0, total: 0, passMark: doc.pass_mark ?? 100 } : null);
  const [sigReset, setSigReset] = useState(0);
  const questions = current?.questions ?? [];
  const needsQuiz = questions.length > 0;
  const nameMatches = myName != null && typed.trim() !== '' && normalisePerson(typed) === normalisePerson(myName);
  const readyToSign = Boolean(mine && mine.status === 'pending' && readToEnd && nameMatches && (!needsQuiz || attempt?.passed));

  async function checkAnswers() {
    if (!current) return;
    if (questions.some((q) => answers[q.id] == null)) { setError('Answer every question first.'); return; }
    setBusy('quiz'); setError(null);
    try {
      const { data, error: e } = await createClient().rpc('answer_document_quiz', { p_version: current.id, p_answers: questions.map((q) => answers[q.id]) });
      if (e) throw new Error(e.message);
      const r = data as { attempt_id: string; score: number; total: number; passed: boolean; pass_mark: number };
      setAttempt({ id: r.attempt_id, passed: r.passed, score: r.score, total: r.total, passMark: r.pass_mark });
      if (!r.passed) setAnswers({});
    } catch (e) { setError(e instanceof Error ? e.message : 'The check did not go through.'); } finally { setBusy(null); }
  }

  async function signMyself(blob: Blob) {
    if (!current || !mine || !myName) return;
    setBusy('sign'); setError(null);
    try {
      const ackId = outbox.newId();
      const path = `${projectId}/document/${ackId}/sig.png`;
      const at = new Date().toISOString();
      const timeOnPage = Math.min(86_400, Math.round((Date.now() - openedAt.current) / 1000));
      const row = { id: ackId, version_id: current.id, person_name: myName, signature_path: path, project_id: projectId, recorded_by: userId, acknowledged_on_device_at: at, typed_name: typed.trim(), time_on_page_s: timeOnPage, quiz_attempt_id: attempt?.id ?? null };
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('document_acknowledgements').insert(row);
        if (insErr) throw new Error(/row-level security/i.test(insErr.message) ? 'The signature was refused: the name must be your own, and the check passed.' : insErr.message);
      };
      const queue = () => outbox.enqueue({ kind: 'doc_ack', projectId, subjectId: current.id, payload: { ackId, name: myName, path, at, by: userId, typedName: typed.trim(), timeOnPage, attemptId: attempt?.id ?? null }, blobs: { signature: blob } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome !== 'sent') setPending((p) => [...p, myName]);
      setNotice(outcome === 'sent' ? `Signed. ${doc.title} v${current.version} is on your record.` : 'Kept on this phone — no signal. It sends on its own when you are back in range.');
      setSigReset((n) => n + 1);
      if (outcome === 'sent') router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That signature did not save.'); } finally { setBusy(null); }
  }

  // ---- Recording a crew member by hand (people without accounts) --------------------------------
  const [handName, setHandName] = useState('');
  const [handReset, setHandReset] = useState(0);
  const acks = current?.document_acknowledgements ?? [];
  const signedNames = new Set([...acks.map((a) => normalisePerson(a.person_name)), ...pending.map(normalisePerson)]);
  const cov = coverage(crew, [...acks.map((a) => a.person_name), ...pending]);
  async function recordByHand(blob: Blob) {
    const trimmed = handName.trim();
    if (!current) return;
    if (!trimmed) { setError('Name first, then sign.'); return; }
    if (myName && normalisePerson(trimmed) === normalisePerson(myName)) { setError('Sign for yourself in the block above — by hand is for people without an account.'); return; }
    if (signedNames.has(normalisePerson(trimmed))) { setError(`${trimmed} has already signed this version.`); return; }
    setBusy('hand'); setError(null);
    try {
      const ackId = outbox.newId();
      const path = `${projectId}/document/${ackId}/sig.png`;
      const at = new Date().toISOString();
      const live = async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from('document_acknowledgements').insert({ id: ackId, version_id: current.id, person_name: trimmed, signature_path: path, project_id: projectId, recorded_by: userId, acknowledged_on_device_at: at });
        if (insErr) throw new Error(insErr.message);
      };
      const queue = () => outbox.enqueue({ kind: 'doc_ack', projectId, subjectId: current.id, payload: { ackId, name: trimmed, path, at, by: userId }, blobs: { signature: blob } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome !== 'sent') setPending((p) => [...p, trimmed]);
      setHandName(''); setHandReset((n) => n + 1);
      if (outcome === 'sent') router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That signature did not save.'); } finally { setBusy(null); }
  }

  // ---- Manager actions -----------------------------------------------------------------------
  const [waiving, setWaiving] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  async function waive(a: AssignmentRow) {
    setBusy(`waive:${a.id}`); setError(null);
    try {
      const { error: e } = await createClient().from('document_assignments').update({ status: 'waived', waive_reason: waiveReason.trim() }).eq('id', a.id);
      if (e) throw new Error(e.message);
      setWaiving(null); setWaiveReason(''); setNotice('Waived, with the reason on the record.'); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); } finally { setBusy(null); }
  }
  async function issueDraft() {
    if (!draft) return;
    setBusy('issue'); setError(null);
    try {
      const { error: e } = await createClient().from('document_versions').update({ status: 'current' }).eq('id', draft.id);
      if (e) throw new Error(e.message);
      await post('/api/procedures/notify', { versionId: draft.id }, 'issue');
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not issue.'); setBusy(null); }
  }

  const chip = (state: string) => (state === 'overdue' ? 'status-pill status-pill--danger' : state === 'due_soon' ? 'status-pill status-pill--gap' : state === 'signed' ? 'status-pill status-pill--ready' : 'status-pill');
  const myState = mine ? dueState(mine, today) : null;

  return (
    <section className="procedure">
      <p className="label">{KIND_LABEL[doc.kind]}{doc.doc_number ? ` · ${doc.doc_number}` : ''}{doc.active ? '' : ' · archived'}</p>
      <h1 className="page-title">{doc.title}</h1>
      {current ? (
        <p className="page-subtitle">Version {current.version} · issued {current.issued_at ? fmtPerthDate(current.issued_at) : ''}{current.change_summary || current.summary ? ` — ${current.change_summary ?? current.summary}` : ''}</p>
      ) : <p className="page-subtitle vr-missing">No version issued yet.</p>}
      {canManage && <p className="caption">For {audienceText(doc.audience).toLowerCase()} · {doc.ack_due_days} days to sign{doc.review_interval_months ? ` · reviewed every ${doc.review_interval_months} months` : ''}{doc.pass_mark ? ` · check pass mark ${doc.pass_mark}%` : ''}</p>}
      {current && urls[current.file_path] && <a className="button" href={urls[current.file_path]} target="_blank" rel="noopener">Open the document</a>}
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && !error && <p className="notice" role="status">{notice}</p>}

      {/* The draft, waiting */}
      {canManage && draft && (
        <div className="item docs__draft">
          <p className="label">Draft version {draft.version} — not issued, nobody has been told</p>
          {draft.change_summary || draft.summary ? <p>{draft.change_summary ?? draft.summary}</p> : null}
          {urls[draft.file_path] && <a className="linklike" href={urls[draft.file_path]} target="_blank" rel="noopener">Open the draft file</a>}
          <QuestionsEditor versionId={draft.id} initial={draft.questions} passMark={doc.pass_mark} />
          <div className="regs__actions">
            <button type="button" className="button" disabled={busy !== null} onClick={() => void issueDraft()}>{busy === 'issue' ? 'Issuing…' : `Issue version ${draft.version} now`}</button>
            <span className="caption">Issuing supersedes v{current?.version ?? '—'}, assigns everyone it binds with {doc.ack_due_days} days to sign, and tells them.</span>
          </div>
        </div>
      )}

      {/* Mine */}
      {current && doc.requires_acknowledgement && mine && (
        <div className={`item docs__mine${myState === 'overdue' ? ' item--warn' : ''}`}>
          {mine.status === 'signed' ? (
            <p className="label">You signed version {current.version}{mine.signed_at ? ` on ${fmtPerthDate(mine.signed_at)}` : ''}.</p>
          ) : mine.status === 'waived' ? (
            <p className="label">Waived for you{mine.waive_reason ? ` — ${mine.waive_reason}` : ''}.</p>
          ) : (
            <>
              <p className="label">Read and sign · <span className={chip(myState ?? 'due')}>{DUE_LABEL[myState ?? 'due']}</span> · by {fmtDate(mine.due_on)}</p>
              <ol className="docs__steps">
                <li>Open the document above and read it to the end.</li>
                {needsQuiz && (
                  <li>
                    Answer the questions{doc.pass_mark ? ` — pass mark ${doc.pass_mark}%` : ''}.
                    {attempt?.passed ? <span className="status-pill status-pill--ready" style={{ marginLeft: '.5rem' }}>Passed{attempt.total ? ` ${attempt.score} of ${attempt.total}` : ''}</span> : (
                      <div className="docs__quiz">
                        {questions.map((q) => (
                          <fieldset key={q.id} className="docs__q">
                            <legend>{q.position}. {q.prompt}</legend>
                            {q.options.map((o, i) => (
                              <label key={i} className="regs__tick"><input type="radio" name={`q-${q.id}`} checked={answers[q.id] === i} onChange={() => setAnswers((a) => ({ ...a, [q.id]: i }))} /><span>{o}</span></label>
                            ))}
                          </fieldset>
                        ))}
                        {attempt && !attempt.passed && <p className="alert">Not yet — {attempt.score} of {attempt.total} right, {attempt.passMark}% needed. Read it again and have another go; every attempt is recorded.</p>}
                        <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void checkAnswers()}>{busy === 'quiz' ? 'Checking…' : 'Check my answers'}</button>
                      </div>
                    )}
                  </li>
                )}
                <li>
                  <label className="regs__tick"><input type="checkbox" checked={readToEnd} onChange={(e) => setReadToEnd(e.target.checked)} /><span>I have read version {current.version} to the end and I understand it.</span></label>
                </li>
                <li>
                  <label className="fieldcell"><span className="label">Type your full name{myName ? ` — ${myName}` : ''}</span>
                    <input className="field field--sm" value={typed} placeholder={myName ?? 'Your name'} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
                  {typed.trim() && !nameMatches && <p className="caption vr-missing">That is not the name on your account{myName ? ` (${myName})` : ''}.</p>}
                </li>
                <li>
                  Sign below.
                  <SignaturePad disabled={!readyToSign} saving={busy === 'sign'} onSave={signMyself} resetToken={sigReset} />
                  {!readyToSign && <p className="caption">The pad opens when the steps above are done.</p>}
                </li>
              </ol>
            </>
          )}
        </div>
      )}

      {/* Who has signed */}
      {current && doc.requires_acknowledgement && (canManage || canSign) && (
        <div className="item">
          <p className="label">Who has signed version {current.version}</p>
          {canManage && current.assignments.length > 0 && (
            <>
              <div className="regs__actions" style={{ marginTop: 0 }}>
                <button type="button" className="button button--quiet" disabled={busy !== null || !current.assignments.some((a) => a.status === 'pending')} onClick={() => void post('/api/procedures/remind', { versionId: current.id }, 'remind-all')}>
                  {busy === 'remind-all' ? 'Reminding…' : `Remind everyone still to sign (${current.assignments.filter((a) => a.status === 'pending').length})`}
                </button>
              </div>
              <table className="docs__table">
                <thead><tr><th>Person</th><th>Role · jobs</th><th>Due</th><th>State</th><th></th></tr></thead>
                <tbody>
                  {current.assignments.map((a) => {
                    const p = names.get(a.user_id); const state = dueState(a, today);
                    return (
                      <tr key={a.id}>
                        <td>{p?.name ?? '—'}</td>
                        <td className="caption">{[p?.roles.join('/'), p?.jobs.join(', ')].filter(Boolean).join(' · ')}</td>
                        <td>{fmtDate(a.due_on)}</td>
                        <td><span className={chip(state)}>{DUE_LABEL[state]}</span>{a.status === 'signed' && a.signed_at ? <span className="caption"> {fmtPerthDate(a.signed_at)}</span> : null}{a.reminder_count > 0 ? <span className="caption"> · reminded {a.reminder_count}×</span> : null}{a.status === 'waived' && a.waive_reason ? <span className="caption"> · {a.waive_reason}</span> : null}</td>
                        <td>
                          {a.status === 'pending' && waiving !== a.id && (
                            <span className="regs__links">
                              <button type="button" className="linklike" disabled={busy !== null} onClick={() => void post('/api/procedures/remind', { versionId: current.id, userIds: [a.user_id] }, `remind:${a.id}`)}>Remind</button>
                              <button type="button" className="linklike" onClick={() => { setWaiving(a.id); setWaiveReason(''); }}>Waive</button>
                            </span>
                          )}
                          {waiving === a.id && (
                            <span className="regs__links">
                              <input className="field field--sm" placeholder="Why — on leave, left the company…" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
                              <button type="button" className="button button--quiet" disabled={busy !== null || !waiveReason.trim()} onClick={() => void waive(a)}>Waive</button>
                              <button type="button" className="linklike" onClick={() => setWaiving(null)}>Cancel</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {acks.filter((a) => !current.assignments.some((x) => x.acknowledgement_id === a.id)).length > 0 && (
            <>
              <p className="label" style={{ marginTop: '.75rem' }}>Recorded by hand · {acks.filter((a) => !current.assignments.some((x) => x.acknowledgement_id === a.id)).length}</p>
              {acks.filter((a) => !current.assignments.some((x) => x.acknowledgement_id === a.id)).map((a) => <div key={a.id} className="talk-attendee"><span className="talk-attendee__pending" /><span>{a.person_name}<span className="caption"> · {fmtPerthDate(a.acknowledged_on_device_at)}</span></span></div>)}
            </>
          )}
          {pending.map((p) => <div key={p} className="talk-attendee"><span className="talk-attendee__pending" /><span>{p}<span className="pending-tag">waiting for signal</span></span></div>)}
          {canSign && (
            <details className="docs__hand" style={{ marginTop: '1rem' }}>
              <summary>Record a signature by hand — for someone without an account</summary>
              <p className="way-hint">They read the document on your phone, you tap or type their name, and they sign: “I have read and understood this.” Not for yourself: sign your own above.</p>
              {crew.filter((c) => !signedNames.has(normalisePerson(c))).length > 0 && (
                <div className="crewchips">{crew.filter((c) => !signedNames.has(normalisePerson(c))).map((c) => <button key={c} type="button" className={`quotebtn crewchip${handName === c ? ' crewchip--on' : ''}`} onClick={() => setHandName(c)}>{c}</button>)}</div>
              )}
              {cov.unread.length > 0 && <p className="caption">{cov.unread.length} on this job&rsquo;s crew list not yet signed.</p>}
              <label className="fieldcell"><span className="label">Name</span><input className="field field--sm" value={handName} placeholder="Kel Brady" onChange={(e) => setHandName(e.target.value)} /></label>
              <SignaturePad saving={busy === 'hand'} onSave={recordByHand} resetToken={handReset} />
            </details>
          )}
        </div>
      )}

      {canManage && !revising && <button type="button" className="button button--quiet" onClick={() => setRevising(true)}>Issue a new version</button>}
      {revising && (
        <>
          <p className="label" style={{ marginTop: '1rem' }}>New version of {doc.title}</p>
          <IssueForm orgId={doc.orgId} projectId={projectId} userId={userId} documentId={doc.id} existing={{ title: doc.title, kind: doc.kind, doc_number: doc.doc_number, audience: doc.audience, ack_due_days: doc.ack_due_days, review_interval_months: doc.review_interval_months, pass_mark: doc.pass_mark, requires_acknowledgement: doc.requires_acknowledgement }} />
          <button type="button" className="linklike" onClick={() => setRevising(false)}>Not now</button>
        </>
      )}

      {doc.versions.filter((v) => v.status === 'superseded').length > 0 && (
        <div className="item">
          <p className="label">Earlier versions</p>
          {doc.versions.filter((v) => v.status === 'superseded').map((v) => (
            <p key={v.id} className="caption">v{v.version} · issued {v.issued_at ? fmtPerthDate(v.issued_at) : ''}{v.superseded_at ? `, superseded ${fmtPerthDate(v.superseded_at)}` : ''} · {v.document_acknowledgements.length} signed{urls[v.file_path] ? <> · <a href={urls[v.file_path]} target="_blank" rel="noopener">file</a></> : null}</p>
          ))}
        </div>
      )}
    </section>
  );
}
