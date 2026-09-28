'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { messageState, pushOutcomeText, type MessageRow } from '@/lib/messages/model';

export interface Person { id: string; name: string; roles: string[]; jobs: string[]; devices: number }
export interface SentRow extends MessageRow { to: string; from: string; job: string | null }
const clock = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const QUICK = ['Take photos of today’s work before you leave.', 'Sign on to the SWMS before you start.', 'Ring the office when you get a minute.', 'Do your prestart before starting the machine.'];

export function SendMessage({ orgId, people, jobs, defaultJob, sent }: { orgId: string; people: Person[]; jobs: Array<{ id: string; code: string; name: string }>; defaultJob: string; sent: SentRow[] }) {
  const router = useRouter();
  const [to, setTo] = useState('');
  const [job, setJob] = useState(defaultJob);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const person = people.find((p) => p.id === to);

  async function send() {
    if (!to) { setError('Pick who it is for.'); return; }
    if (!body.trim()) { setError('Write the message.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, recipientId: to, projectId: job || null, body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'That did not send.');
      setNotice(json.message ?? 'Sent.'); setBody('');
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not send.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="msg">
      <section className="item msg__form">
        <label className="fieldcell" htmlFor="msg-to"><span className="label">To</span>
          <select id="msg-to" className="field field--sm" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Pick a person…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.roles.join('/')} · {p.jobs.join(', ')}</option>)}
          </select></label>
        {person && <p className={`caption${person.devices ? '' : ' msg__nophone'}`}>{person.devices ? `${person.name} has ${person.devices} phone${person.devices === 1 ? '' : 's'} registered for notifications.` : `${person.name} has no phone registered for notifications yet — they will see the message when they open the app. Notifications are turned on under Messages for you.`}</p>}
        <label className="fieldcell" htmlFor="msg-job"><span className="label">About which job (optional)</span>
          <select id="msg-job" className="field field--sm" value={job} onChange={(e) => setJob(e.target.value)}>
            <option value="">No particular job</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}
          </select></label>
        <label className="fieldcell" htmlFor="msg-body"><span className="label">Message</span>
          <textarea id="msg-body" className="field" rows={3} maxLength={2000} value={body} placeholder="Take photos of the trench before backfill." onChange={(e) => setBody(e.target.value)} /></label>
        <div className="msg__quick">
          {QUICK.map((q) => <button key={q} type="button" className="chip chip--link" onClick={() => setBody(q)}>{q}</button>)}
        </div>
        {error && <p className="alert">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button type="button" className="button" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button>
      </section>

      <p className="label" style={{ marginTop: '1.25rem' }}>Sent · {sent.length}</p>
      {sent.length === 0 ? <p className="claims-nil">Nothing sent yet.</p> : (
        <ul className="plainlist msg__list">
          {sent.map((m) => {
            const st = messageState(m);
            return (
              <li key={m.id} className={`msg__row msg__row--${st}`}>
                <div className="msg__main">
                  <p className="msg__head"><strong>{m.to}</strong>{m.job ? ` · ${m.job}` : ''} <span className="caption">· {fmtPerthDate(m.sent_at)} {clock(m.sent_at)} · by {m.from}</span></p>
                  <p className="msg__body">{m.body}</p>
                  <p className="caption">{pushOutcomeText(m.push_result, m.push_devices)}</p>
                </div>
                <span className={`msg__state msg__state--${st}`}>
                  {st === 'acknowledged' ? `Got it · ${fmtPerthDate(m.acknowledged_at!)} ${clock(m.acknowledged_at!)}` : st === 'read' ? `Opened · ${fmtPerthDate(m.read_at!)} ${clock(m.read_at!)}` : 'Not opened yet'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
