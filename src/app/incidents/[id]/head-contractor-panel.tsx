'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { perthDay } from '@/lib/incidents/regulator';
import { noticeState, headContractorName, NOTICE_METHODS, NOTICE_METHOD_LABEL, type IncidentNotice, type NoticeMethod } from '@/lib/subcontract/model';

const perthLocalNow = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
const fromPerthLocal = (v: string) => new Date(`${v}:00+08:00`).toISOString();

/**
 * Reporting up (README R74). On a job run by a head contractor, every hazard, near miss and
 * incident goes to them — usually within a time their site rules set — whatever else is owed to
 * WorkSafe. Each time they are told is its own dated row, never changed.
 */
export function HeadContractorPanel({ incidentId, projectId, occurredAt, contractor, hours, notices, canRecord, defaultName, now, envToldAt = null }: {
  /** When the environmental panel recorded telling the head contractor or Superintendent: the same call, not a second duty. */
  envToldAt?: string | null;
  incidentId: string; projectId: string; occurredAt: string; contractor: string | null; hours: number | null; notices: IncidentNotice[]; canRecord: boolean; defaultName: string; now: string;
}) {
  const router = useRouter();
  const name = headContractorName(contractor);
  const pending = usePending('hc_notice', incidentId).map((q) => ({ ...(q.payload.row as IncidentNotice), queued: true }));
  const st = noticeState(occurredAt, [...notices, ...pending], hours, now);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(perthLocalNow());
  const [method, setMethod] = useState<NoticeMethod>('phone');
  const [by, setBy] = useState(defaultName);
  const [to, setTo] = useState('');
  const [ref, setRef] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string) => `${fmtDate(perthDay(iso))} ${awstClock(iso)}`;

  async function save() {
    setBusy(true); setError(null);
    try {
      const row = {
        id: outbox.newId(), incident_id: incidentId, notified_at: fromPerthLocal(at), method, told_by_name: by.trim(),
        recipient_name: to.trim() || null, reference: ref.trim() || null, detail: detail.trim() || null,
      };
      const live = async () => {
        const { error: e } = await createClient().from('incident_notices').insert(row);
        if (e) throw new Error(e.message);
      };
      const queue = () => outbox.enqueue({ kind: 'hc_notice', projectId, subjectId: incidentId, payload: { row } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setOpen(false); setTo(''); setRef(''); setDetail('');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...notices.map((n) => ({ ...n, queued: false })), ...pending].sort((a, b) => a.notified_at.localeCompare(b.notified_at));
  return (
    <div className={`item regpanel${!st.toldAt ? ' item--warn' : ''}`} style={{ marginTop: '0.9rem' }}>
      <p className="label">Reported to {name}</p>
      {!st.toldAt && envToldAt ? (
        <p className="caption">Told {when(envToldAt)} — recorded on the environmental incident&rsquo;s trail below.</p>
      ) : st.toldAt ? (
        <p className="caption">Told {when(st.toldAt)}{st.minutesToTell != null ? ` · ${st.minutesToTell < 120 ? `${st.minutesToTell} min` : `${Math.round(st.minutesToTell / 60)} h`} after it happened` : ''}.</p>
      ) : (
        <p className={`caption${st.overdue ? ' vr-missing' : ''}`}>
          Not yet recorded as told.{st.dueAt ? ` Their rules want it by ${when(st.dueAt)}${st.overdue ? ' — overdue' : ''}.` : ''}
        </p>
      )}
      {sorted.length > 0 && (
        <ul className="gaplist">
          {sorted.map((n) => (
            <li key={n.id} className="caption">
              <strong>{when(n.notified_at)}</strong> · {NOTICE_METHOD_LABEL[n.method]} · by {n.told_by_name}
              {n.recipient_name ? ` to ${n.recipient_name}` : ''}{n.reference ? ` · their ref ${n.reference}` : ''}{n.detail ? ` · ${n.detail}` : ''}
              {n.queued ? <strong> · saved on this phone, sends when there is signal</strong> : null}
            </li>
          ))}
        </ul>
      )}
      {canRecord && !open && <button type="button" className="linklike" onClick={() => { setOpen(true); setAt(perthLocalNow()); }}>{st.toldAt ? `Record another contact with ${name}` : `Record telling ${name}`}</button>}
      {open && (
        <div className="regpanel__form">
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">When (Perth time)</span>
              <input id="hc-at" className="field field--sm" type="datetime-local" value={at} max={perthLocalNow()} onChange={(e) => setAt(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">How</span>
              <select id="hc-method" className="field field--sm" value={method} onChange={(e) => setMethod(e.target.value as NoticeMethod)}>
                {NOTICE_METHODS.map((m) => <option key={m} value={m}>{NOTICE_METHOD_LABEL[m]}</option>)}
              </select></label>
          </div>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Told by</span><input id="hc-by" className="field field--sm" value={by} onChange={(e) => setBy(e.target.value)} /></label>
            <label className="fieldcell"><span className="label">Told who</span><input id="hc-to" className="field field--sm" placeholder="Their site manager or HSE advisor" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <label className="fieldcell"><span className="label">Their reference</span><input id="hc-ref" className="field field--sm" placeholder="Incident number in their system, if given" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">Detail</span><input id="hc-detail" className="field field--sm" value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
          <button type="button" className="button" disabled={busy || !by.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Record it'}</button>
          <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
          <p className="caption">Once recorded it cannot be changed.</p>
        </div>
      )}
    </div>
  );
}
