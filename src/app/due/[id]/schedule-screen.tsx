'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import {
  nextDue, dueStatus, onTime, daysLate, KIND_LABEL, STATUS_LABEL,
  type ObligationKind,
} from '@/lib/obligations/model';

interface Completion {
  id: string;
  due_on: string;
  done_on: string;
  evidence_note: string;
  evidence_ref: string | null;
  created_at: string;
  doneByName: string | null;
}

interface Props {
  obligation: { id: string; kind: ObligationKind; intervalMonths: number | null; firstDueOn: string; active: boolean; companyWide: boolean };
  completions: Completion[];
  today: string;
  canManage: boolean;
  userId: string;
}

/**
 * Mark the occurrence done, with what shows it happened. The day it was due is
 * taken from the schedule as it stands, not typed, so "was it on time" cannot
 * be adjusted after the fact; the day it was done is the person's, and the
 * database refuses a day in the future. Once saved a completion is frozen.
 */
export function ScheduleScreen({ obligation, completions, today, canManage }: Props) {
  const router = useRouter();
  const [doneOn, setDoneOn] = useState(today);
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedule = { first_due_on: obligation.firstDueOn, interval_months: obligation.intervalMonths, active: obligation.active };
  const due = nextDue(schedule, completions);
  const status = dueStatus(due, today);
  const history = [...completions].sort((a, b) => b.done_on.localeCompare(a.done_on));
  const late = history.filter((c) => !onTime(c)).length;

  async function markDone() {
    if (!due) return;
    if (!note.trim()) { setError('Say what shows it happened — the audit report, who attended the drill, the minutes.'); return; }
    setBusy('done');
    setError(null);
    try {
      const { error: e } = await createClient().from('obligation_completions').insert({
        obligation_id: obligation.id, due_on: due, done_on: doneOn,
        evidence_note: note.trim(), evidence_ref: ref.trim() || null,
      });
      if (e) throw new Error(e.message);
      setNote(''); setRef(''); setDoneOn(today);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function setActive(active: boolean) {
    setBusy('active');
    setError(null);
    try {
      const { error: e } = await createClient().from('obligations').update({ active }).eq('id', obligation.id);
      if (e) throw new Error(e.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}

      <div className={`item${status === 'overdue' ? ' item--warn' : ''}`}>
        <p className="label">{KIND_LABEL[obligation.kind]}{obligation.companyWide ? ' · whole company' : ''}</p>
        <p style={{ margin: '0.3rem 0 0', fontWeight: 600 }} className={status === 'overdue' ? 'vr-missing' : undefined}>
          {!obligation.active ? 'Retired' : due ? `${STATUS_LABEL[status]} · ${status === 'overdue' ? 'was due' : 'next due'} ${fmtDate(due)}` : 'Done — it happens once'}
        </p>
        <p className="caption">
          {obligation.intervalMonths ? `Every ${obligation.intervalMonths} month${obligation.intervalMonths === 1 ? '' : 's'}, counted from when the last one was done` : 'Once'}
          {history.length > 0 ? ` · ${history.length} done, ${late === 0 ? 'all on time' : `${late} late`}` : ''}
        </p>
      </div>

      {canManage && obligation.active && due && (
        <div className="item" style={{ marginTop: '0.9rem' }}>
          <p className="label">Mark it done</p>
          <p className="caption">This discharges the occurrence due {fmtDate(due)}.</p>
          <label className="fieldcell">
            <span className="label">Done on</span>
            <input className="field field--sm" id="done-on" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} />
          </label>
          <label className="fieldcell">
            <span className="label">What shows it happened</span>
            <textarea className="field field--sm" id="done-note" rows={3} value={note}
              placeholder="Audit of the Busport works by R. Singh, 4 findings raised. Evacuation drill, 11 on site, muster in 3 min."
              onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="fieldcell">
            <span className="label">Reference</span>
            <input className="field field--sm" id="done-ref" value={ref} placeholder="Report number, inspection, document — optional" onChange={(e) => setRef(e.target.value)} />
          </label>
          <button type="button" className="button" disabled={busy !== null || !note.trim()} onClick={() => void markDone()}>
            {busy === 'done' ? 'Saving…' : 'Mark it done'}
          </button>
          <p className="caption">Once saved it cannot be changed or removed.</p>
        </div>
      )}

      <hr className="rule" />
      <p className="label">Every occurrence</p>
      {history.length === 0 ? (
        <p className="nil">Not done yet.</p>
      ) : (
        <ul className="gaplist">
          {history.map((c) => (
            <li key={c.id}>
              <strong>Done {fmtDate(c.done_on)}</strong> · due {fmtDate(c.due_on)} ·{' '}
              <span className={onTime(c) ? undefined : 'vr-missing'}>{onTime(c) ? 'on time' : `${daysLate(c)} day${daysLate(c) === 1 ? '' : 's'} late`}</span>
              {c.doneByName ? ` · ${c.doneByName}` : ''}
              <br /><span className="caption">{c.evidence_note}{c.evidence_ref ? ` · ${c.evidence_ref}` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <p style={{ marginTop: '1rem' }}>
          {obligation.active
            ? <button type="button" className="linklike" disabled={busy !== null} onClick={() => void setActive(false)}>Retire this schedule</button>
            : <button type="button" className="linklike" disabled={busy !== null} onClick={() => void setActive(true)}>Bring it back</button>}
        </p>
      )}
    </>
  );
}
