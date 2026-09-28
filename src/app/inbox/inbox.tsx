'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtPerthDate } from '@/lib/pdf/dates';

type Row = { id: string; body: string; sent_at: string; read_at: string | null; acknowledged_at: string | null; from: string; job: string | null };
const clock = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** The list, newest first. Being shown is being read: unread ones are stamped as the page opens. "Got it" is a tap. */
export function Inbox({ rows }: { rows: Row[] }) {
  const params = useSearchParams();
  const [list, setList] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    for (const r of rows) {
      if (r.read_at) continue;
      void supabase.rpc('mark_message_read', { p_id: r.id }).then(({ data }) => {
        if (data) setList((cur) => cur.map((x) => (x.id === r.id ? { ...x, read_at: String(data) } : x)));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const m = params.get('m');
    if (m) document.getElementById(`m-${m}`)?.scrollIntoView({ block: 'center' });
  }, [params]);
  async function gotIt(id: string) {
    setBusy(id); setError(null);
    try {
      const { data, error: err } = await createClient().rpc('acknowledge_message', { p_id: id });
      if (err) throw new Error(err.message);
      setList((cur) => cur.map((x) => (x.id === id ? { ...x, acknowledged_at: String(data), read_at: x.read_at ?? String(data) } : x)));
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not save.'); }
    finally { setBusy(null); }
  }
  if (list.length === 0) return <p className="claims-nil">Nothing yet. When the office sends you something, it shows here and on your phone.</p>;
  return (
    <ul className="plainlist inbox">
      {error && <p className="alert">{error}</p>}
      {list.map((m) => (
        <li key={m.id} id={`m-${m.id}`} className={`inbox__msg${m.acknowledged_at ? ' inbox__msg--done' : ''}${!m.read_at ? ' inbox__msg--new' : ''}`}>
          <p className="inbox__meta caption">{m.from}{m.job ? ` · ${m.job}` : ''} · {fmtPerthDate(m.sent_at)} {clock(m.sent_at)}</p>
          <p className="inbox__body">{m.body}</p>
          {m.acknowledged_at
            ? <p className="caption inbox__ack">Got it · {fmtPerthDate(m.acknowledged_at)} {clock(m.acknowledged_at)}</p>
            : <button type="button" className="button" disabled={busy === m.id} onClick={() => void gotIt(m.id)}>{busy === m.id ? 'Saving…' : 'Got it'}</button>}
        </li>
      ))}
    </ul>
  );
}
