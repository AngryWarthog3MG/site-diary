'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { perthDay } from '@/lib/incidents/regulator';
import {
  envIncidentState, ENV_EVENT_KINDS, ENV_EVENT_LABEL, SEVERITIES_204, SEVERITY_204_LABEL, DWER_TRIGGERS, DWER_TRIGGER_LABEL,
  type EnvEvent, type EnvEventKind, type EnvClocks, type Severity204, type DwerTrigger,
} from '@/lib/environment/model';

const perthLocalNow = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
const fromPerthLocal = (v: string) => new Date(`${v}:00+08:00`).toISOString();

/**
 * The environmental trail for an environmental incident (README R73): its severity on
 * the contract's scale, the Superintendent told, the report and investigation within the
 * contract's clocks, and — where the discharge is notifiable under EP Act s. 72 — written
 * notice to DWER. Each step is its own dated row, never changed.
 */
export function EnvironmentPanel({ incidentId, occurredAt, events, clocks, canManage, now }: { incidentId: string; occurredAt: string; events: EnvEvent[]; clocks: EnvClocks; canManage: boolean; now: string }) {
  const router = useRouter();
  const state = envIncidentState(occurredAt, events, clocks, now);
  const [adding, setAdding] = useState<EnvEventKind | null>(null);
  const [at, setAt] = useState(perthLocalNow());
  const [severity, setSeverity] = useState<Severity204>('minor');
  const [serious, setSerious] = useState(false);
  const [trigger, setTrigger] = useState<DwerTrigger>('emergency_accident_malfunction');
  const [who, setWho] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const when = (iso: string | null) => (iso ? `${fmtDate(perthDay(iso))} ${awstClock(iso)}` : '—');
  const noClocks = clocks.seriousHours == null && clocks.minorHours == null && clocks.investigationDays == null;

  async function save() {
    if (!adding) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await createClient().from('incident_environment_events').insert({
        incident_id: incidentId, kind: adding, happened_at: fromPerthLocal(at),
        severity: adding === 'assessed' ? severity : null, serious: adding === 'assessed' ? serious : null,
        dwer_trigger: adding === 'dwer_notifiable' ? trigger : null,
        person_name: who.trim() || null, detail: detail.trim() || null,
      });
      if (e) throw new Error(e.message);
      setAdding(null); setWho(''); setDetail('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`item regpanel${state.outstanding.length ? ' item--warn' : ''}`} style={{ marginTop: '0.9rem' }}>
      <p className="label">Environmental incident — contract and EP Act</p>
      {state.outstanding.length ? (
        <ul className="gaplist regpanel__todo">{state.outstanding.map((o) => <li key={o} className="vr-missing">{o}</li>)}</ul>
      ) : <p className="caption">Every step recorded.</p>}

      <dl className="regpanel__facts">
        <dt>Severity</dt><dd>{state.severity ? `${SEVERITY_204_LABEL[state.severity]}${state.serious ? ' · Serious' : ''}` : '—'}</dd>
        <dt>Superintendent</dt><dd>{when(state.superintendentNotifiedAt)}</dd>
        <dt>Incident report</dt>
        <dd className={state.reportOverdue ? 'vr-missing' : undefined}>
          {state.reportGivenAt ? `Given ${when(state.reportGivenAt)}` : state.reportDueAt ? `Due by ${when(state.reportDueAt)}${state.reportOverdue ? ' — overdue' : ''}` : noClocks ? 'No contract clock set for this job' : 'Assess the severity to start the clock'}
        </dd>
        {(state.investigationDueAt || state.investigationGivenAt) && (
          <><dt>Investigation</dt><dd className={state.investigationOverdue ? 'vr-missing' : undefined}>{state.investigationGivenAt ? `Given ${when(state.investigationGivenAt)}` : `Due by ${when(state.investigationDueAt)}${state.investigationOverdue ? ' — overdue' : ''}`}</dd></>
        )}
        <dt>DWER (s. 72)</dt>
        <dd>{state.dwerNotifiable ? `${state.dwerTrigger ? DWER_TRIGGER_LABEL[state.dwerTrigger] : 'Notifiable'} · ${state.dwerWrittenAt ? `written notice ${when(state.dwerWrittenAt)}` : 'written notice outstanding'}` : 'Not recorded as notifiable'}</dd>
      </dl>
      <p className="caption">
        Notifiable to DWER when a discharge has caused or may cause pollution or environmental harm and came from an emergency,
        accident or malfunction, breached an approval, or involves prescribed waste. Environment WAtch is 1300 784 782; the call
        does not replace written notice.
      </p>

      {events.length > 0 && (
        <details className="regpanel__log">
          <summary>Every step, as recorded</summary>
          <ul className="gaplist">
            {[...events].sort((a, b) => a.happened_at.localeCompare(b.happened_at)).map((ev) => (
              <li key={ev.id}>
                <strong>{when(ev.happened_at)}</strong> · {ENV_EVENT_LABEL[ev.kind]}
                {ev.severity ? ` · ${SEVERITY_204_LABEL[ev.severity]}${ev.serious ? ', Serious' : ''}` : ''}
                {ev.dwer_trigger ? ` · ${DWER_TRIGGER_LABEL[ev.dwer_trigger]}` : ''}
                {ev.person_name ? ` · ${ev.person_name}` : ''}{ev.detail ? <><br /><span className="caption">{ev.detail}</span></> : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canManage && !adding && (
        <div className="crewchips" style={{ marginTop: '0.6rem' }}>
          {ENV_EVENT_KINDS.map((k) => <button key={k} type="button" className="quotebtn crewchip" onClick={() => { setAdding(k); setAt(perthLocalNow()); }}>+ {ENV_EVENT_LABEL[k]}</button>)}
        </div>
      )}
      {adding && (
        <div className="regpanel__form">
          {error && <p className="alert" role="alert">{error}</p>}
          <p className="label">{ENV_EVENT_LABEL[adding]}</p>
          <label className="fieldcell"><span className="label">When (Perth time)</span>
            <input id="env-ev-at" className="field field--sm" type="datetime-local" value={at} max={perthLocalNow()} onChange={(ev) => setAt(ev.target.value)} /></label>
          {adding === 'assessed' && (
            <>
              <label className="fieldcell"><span className="label">Severity on the contract&rsquo;s scale</span>
                <select id="env-ev-severity" className="field field--sm" value={severity} onChange={(ev) => setSeverity(ev.target.value as Severity204)}>
                  {SEVERITIES_204.map((s) => <option key={s} value={s}>{SEVERITY_204_LABEL[s]}</option>)}
                </select></label>
              <label className="checkrow checkrow--inline"><input type="checkbox" checked={serious} onChange={(ev) => setSerious(ev.target.checked)} /><span>A Serious incident, as the contract defines it — needs an investigation report</span></label>
            </>
          )}
          {adding === 'dwer_notifiable' && (
            <label className="fieldcell"><span className="label">Why it is notifiable</span>
              <select id="env-ev-trigger" className="field field--sm" value={trigger} onChange={(ev) => setTrigger(ev.target.value as DwerTrigger)}>
                {DWER_TRIGGERS.map((t) => <option key={t} value={t}>{DWER_TRIGGER_LABEL[t]}</option>)}
              </select></label>
          )}
          <label className="fieldcell"><span className="label">Who</span><input id="env-ev-who" className="field field--sm" value={who} onChange={(ev) => setWho(ev.target.value)} /></label>
          <label className="fieldcell"><span className="label">Detail</span><textarea id="env-ev-detail" className="field field--sm" rows={2} placeholder={adding === 'dwer_written_notice' ? 'How it was sent — the form to environmentwatch@dwer.wa.gov.au — and any reference' : ''} value={detail} onChange={(ev) => setDetail(ev.target.value)} /></label>
          <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Record it'}</button>
          <button type="button" className="linklike" onClick={() => setAdding(null)}>Cancel</button>
          <p className="caption">Once recorded it cannot be changed. Get the time right first.</p>
        </div>
      )}
    </div>
  );
}
