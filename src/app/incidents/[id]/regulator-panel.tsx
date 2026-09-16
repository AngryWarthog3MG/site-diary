'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import {
  regulatorState, perthDay, EVENT_LABEL, METHOD_LABEL, METHODS, REGULATOR_EVENT_KINDS,
  type RegulatorEvent, type RegulatorEventKind, type Method,
} from '@/lib/incidents/regulator';

interface Props {
  incidentId: string;
  notifiable: boolean;
  events: RegulatorEvent[];
  canManage: boolean;
  now: string;
}

/** A datetime-local value for now, in Perth, which is what a supervisor on site reads off their watch. */
function perthLocalNow(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16);
}

/** A datetime-local value typed in Perth, as an instant. Perth has no daylight saving. */
function fromPerthLocal(v: string): string {
  return new Date(`${v}:00+08:00`).toISOString();
}

const PROMPT: Record<RegulatorEventKind, { who: string | null; whoPlaceholder: string; detailPlaceholder: string }> = {
  became_aware: { who: null, whoPlaceholder: '', detailPlaceholder: 'How it came to light — a call from the leading hand, the hospital confirmed a fracture' },
  notified: { who: 'Who made the notification', whoPlaceholder: 'Mitchell Van Zyl', detailPlaceholder: 'Officer spoken to, any reference given, any direction about the site' },
  written_notice_required: { who: 'WorkSafe officer', whoPlaceholder: 'Name, if given', detailPlaceholder: 'What was asked for' },
  written_notice_given: { who: 'Who sent it', whoPlaceholder: '', detailPlaceholder: 'How it was sent, and any reference' },
  site_preserved: { who: 'Who has management or control of the workplace', whoPlaceholder: 'Us, or the principal contractor by name', detailPlaceholder: 'What was left as it was, what was made safe' },
  site_released: { who: 'Inspector', whoPlaceholder: 'Name', detailPlaceholder: 'Attended, or directed by phone that work may resume' },
};

/**
 * The WorkSafe trail for a notifiable incident. Each step is its own dated row,
 * never changed afterwards, so the times stand as they were recorded: when the
 * business became aware, when WorkSafe was told, when written notice was asked
 * for and given, and who held the duty to leave the site alone.
 */
export function RegulatorPanel({ incidentId, notifiable, events, canManage, now }: Props) {
  const router = useRouter();
  const state = regulatorState(notifiable, events, now);
  const [adding, setAdding] = useState<RegulatorEventKind | null>(null);
  const [at, setAt] = useState(perthLocalNow());
  const [method, setMethod] = useState<Method>('phone');
  const [who, setWho] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state.applies && !canManage) return null;

  async function save() {
    if (!adding) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await createClient().from('incident_regulator_events').insert({
        incident_id: incidentId, kind: adding, happened_at: fromPerthLocal(at),
        method: adding === 'notified' ? method : null,
        person_name: who.trim() || null, detail: detail.trim() || null,
      });
      if (e) throw new Error(e.message);
      setAdding(null); setWho(''); setDetail(''); setAt(perthLocalNow());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  // The Perth day, not the UTC one: 06:30 in Perth is still the previous day in UTC.
  const when = (iso: string | null) => (iso ? `${fmtDate(perthDay(iso))} ${awstClock(iso)}` : '—');
  const sorted = [...events].sort((a, b) => a.happened_at.localeCompare(b.happened_at));

  if (!state.applies) {
    return (
      <div className="item" style={{ marginTop: '0.9rem' }}>
        <p className="label">WorkSafe WA</p>
        <p className="caption">Not recorded as notifiable. If it turns out to be — a death, a serious injury or illness, or a dangerous incident — record when the business became aware, and notify.</p>
        <button type="button" className="linklike" onClick={() => setAdding('became_aware')}>It is notifiable — record when we became aware</button>
        {adding && renderForm()}
      </div>
    );
  }

  function renderForm() {
    const prompt = PROMPT[adding!];
    return (
      <div className="regpanel__form">
        {error && <p className="alert" role="alert">{error}</p>}
        <p className="label">{EVENT_LABEL[adding!]}</p>
        <label className="fieldcell">
          <span className="label">When (Perth time)</span>
          <input className="field field--sm" id="reg-at" type="datetime-local" value={at} max={perthLocalNow()} onChange={(e) => setAt(e.target.value)} />
        </label>
        {adding === 'notified' && (
          <label className="fieldcell">
            <span className="label">How</span>
            <select className="field field--sm" id="reg-method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </label>
        )}
        {prompt.who && (
          <label className="fieldcell">
            <span className="label">{prompt.who}</span>
            <input className="field field--sm" id="reg-who" value={who} placeholder={prompt.whoPlaceholder} onChange={(e) => setWho(e.target.value)} />
          </label>
        )}
        <label className="fieldcell">
          <span className="label">Detail</span>
          <textarea className="field field--sm" id="reg-detail" rows={2} value={detail} placeholder={prompt.detailPlaceholder} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <button type="button" className="button" disabled={busy || (adding === 'site_preserved' && !who.trim())} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Record it'}
        </button>
        <button type="button" className="linklike" onClick={() => setAdding(null)}>Cancel</button>
        <p className="caption">Once recorded it cannot be changed. Get the time right first.</p>
      </div>
    );
  }

  return (
    <div className={`item regpanel${state.outstanding.length ? ' item--warn' : ''}`} style={{ marginTop: '0.9rem' }}>
      <p className="label">WorkSafe WA — notifiable incident</p>

      {state.outstanding.length > 0 ? (
        <ul className="gaplist regpanel__todo">
          {state.outstanding.map((o) => <li key={o} className="vr-missing">{o}</li>)}
        </ul>
      ) : (
        <p className="caption">Every step recorded.</p>
      )}

      <dl className="regpanel__facts">
        <dt>Became aware</dt><dd>{when(state.becameAwareAt)}</dd>
        <dt>Notified</dt>
        <dd>
          {when(state.notifiedAt)}
          {state.notifiedMethod ? ` · ${METHOD_LABEL[state.notifiedMethod]}` : ''}
          {state.minutesToNotify != null ? ` · ${state.minutesToNotify} min after becoming aware` : ''}
        </dd>
        {state.writtenNoticeDueAt && (
          <>
            <dt>Written notice</dt>
            <dd className={state.writtenNoticeOverdue ? 'vr-missing' : undefined}>
              {state.writtenNoticeGivenAt ? `Given ${when(state.writtenNoticeGivenAt)}` : `Due by ${when(state.writtenNoticeDueAt)}${state.writtenNoticeOverdue ? ' — overdue' : ''}`}
            </dd>
          </>
        )}
        <dt>Site</dt>
        <dd>
          {state.releasedAt ? `Released ${when(state.releasedAt)}` : state.preservedAt ? `Left undisturbed from ${when(state.preservedAt)}` : '—'}
          {state.dutyHolder ? ` · duty held by ${state.dutyHolder}` : ''}
        </dd>
        {state.keepUntil && (<><dt>Keep this record until</dt><dd>at least {fmtDate(state.keepUntil)}</dd></>)}
      </dl>

      {sorted.length > 0 && (
        <details className="regpanel__log">
          <summary>Every step, as recorded</summary>
          <ul className="gaplist">
            {sorted.map((e) => (
              <li key={e.id}>
                <strong>{when(e.happened_at)}</strong> · {EVENT_LABEL[e.kind]}{e.method ? ` ${METHOD_LABEL[e.method]}` : ''}
                {e.person_name ? ` · ${e.person_name}` : ''}{e.detail ? <><br /><span className="caption">{e.detail}</span></> : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canManage && !adding && (
        <div className="crewchips" style={{ marginTop: '0.6rem' }}>
          {REGULATOR_EVENT_KINDS.map((k) => (
            <button key={k} type="button" className="quotebtn crewchip" onClick={() => { setAdding(k); setAt(perthLocalNow()); }}>
              + {EVENT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {adding && renderForm()}
    </div>
  );
}
