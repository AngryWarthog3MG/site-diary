'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  ATTENDEE_STATUS_LABEL, COURSE_KIND_LABEL, RESULT_LABEL, attendedHours, classStateText, classWhen, seatsLeft, ticketBlocker,
  type AttendeeRow, type ClassRow, type CourseRow, type Result,
} from '@/lib/training/courses';
import { Field, Messages, blankToNull, useSave } from '../../../registers/shared';

interface Props { projectId: string; today: string; cls: ClassRow; course: CourseRow; attendees: AttendeeRow[]; ticketsByAttendee: string[]; names: string[]; canManage: boolean }

export function ClassScreen({ projectId, today, cls, course, attendees, ticketsByAttendee, names, canManage }: Props) {
  const { busy, error, notice, run, setError } = useSave();
  const recorded = new Set(ticketsByAttendee);
  const [booking, setBooking] = useState(false);
  const [pick, setPick] = useState(names[0] ?? '');
  const [typed, setTyped] = useState('');
  const [marking, setMarking] = useState<string | null>(null);
  const [result, setResult] = useState<'' | Result>('');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [tickets, setTickets] = useState<{ recorded: Array<{ person: string }>; skipped: Array<{ person: string; why: string }> } | null>(null);

  const seats = seatsLeft(cls, attendees);
  const open = cls.status === 'scheduled';
  const started = classWhen(cls, today) !== 'upcoming';
  const eligible = attendees.filter((a) => !ticketBlocker(a, course, recorded.has(a.id)));
  const q = `?project=${projectId}`;
  const order: Record<string, number> = { attended: 0, booked: 1, absent: 2, withdrawn: 3 };
  const sorted = attendees.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.person_name.localeCompare(b.person_name));

  async function book() {
    const name = (pick === '__other' ? typed : pick).replace(/\s+/g, ' ').trim();
    if (!name) { setError('Whose name?'); return; }
    const done = await run('book', async () => {
      const { error: e } = await createClient().from('training_class_attendees').insert({ class_id: cls.id, person_name: name });
      if (e) throw new Error(/training_attendees_once/i.test(e.message) ? `${name} is already on this class.` : e.message);
      return `${name} booked.`;
    });
    if (done) { setBooking(false); setTyped(''); }
  }
  async function mark(a: AttendeeRow, status: 'attended' | 'absent' | 'withdrawn') {
    const h = hours.trim() ? Number(hours) : null;
    if (status === 'attended' && hours.trim() && !(Number.isFinite(h) && (h as number) > 0)) { setError('Hours is a number, more than none — or blank to take the class\'s.'); return; }
    const done = await run(`mark-${a.id}`, async () => {
      const { data, error: e } = await createClient().from('training_class_attendees')
        .update({ status, result: status === 'attended' && result ? result : null, hours: status === 'attended' ? h : null, notes: blankToNull(note) || a.notes })
        .eq('id', a.id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('That did not save — the booking may be frozen, or you may not keep training.');
      return `${a.person_name}: ${ATTENDEE_STATUS_LABEL[status].toLowerCase()}.`;
    });
    if (done) { setMarking(null); setResult(''); setHours(''); setNote(''); }
  }
  async function setClass(status: 'held' | 'cancelled') {
    if (status === 'cancelled' && !cancelReason.trim()) { setError('Why is it cancelled?'); return; }
    const done = await run('class', async () => {
      const { data, error: e } = await createClient().from('training_classes').update(status === 'held' ? { status } : { status, cancelled_reason: cancelReason.trim() }).eq('id', cls.id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('That did not save.');
      return status === 'held' ? 'Class marked held.' : 'Class cancelled.';
    });
    if (done) setCancelling(false);
  }
  async function recordTickets() {
    await run('tickets', async () => {
      const res = await fetch(`/api/training/classes/${cls.id}/tickets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? 'Could not record the tickets.');
      setTickets({ recorded: body.recorded ?? [], skipped: body.skipped ?? [] });
      return `${(body.recorded ?? []).length} ticket${(body.recorded ?? []).length === 1 ? '' : 's'} recorded.`;
    });
  }

  return (
    <div className="regs">
      <div className="regs__facts" style={{ marginTop: '0.5rem' }}>
        <span className="regs__fact"><span className="regs__fact-label">Course</span><span className="regs__fact-text">{COURSE_KIND_LABEL[course.kind]}{course.unit_of_competency ? ` · ${course.unit_of_competency}` : ''}</span><span className="regs__fact-sub">{course.duration_hours != null ? `${course.duration_hours} h · ` : ''}{course.expiry_months ? `current ${course.expiry_months} months` : 'does not lapse'} · {course.provider === 'external' ? `provider ${course.provider_name ?? ''}` : 'in-house'}</span></span>
        <span className={`regs__fact${cls.status === 'cancelled' ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Status</span><span className="regs__fact-text">{classStateText(cls, today)}</span>{cls.cancelled_reason && <span className="regs__fact-sub">{cls.cancelled_reason}</span>}</span>
        <span className="regs__fact"><span className="regs__fact-label">Seats</span><span className="regs__fact-text">{cls.capacity == null ? 'No cap' : `${seats} of ${cls.capacity} left`}</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Ticket</span><span className="regs__fact-text">{course.competency_key ? course.competency_key.replace(/_/g, ' ') : 'none earned'}</span></span>
      </div>
      {cls.notes && <p className="caption">{cls.notes}</p>}
      <Messages error={error} notice={notice} />

      <div className="photo-add-pair" style={{ marginTop: '0.75rem' }}>
        <a className="button button--quiet" href={`/api/training/classes/${cls.id}/pdf${q}`} target="_blank" rel="noopener">Attendance sheet (PDF)</a>
        {canManage && open && !booking && (seats == null || seats > 0) && <button type="button" className="button" onClick={() => setBooking(true)}>Book someone</button>}
        {canManage && open && started && <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => void setClass('held')}>Mark the class held</button>}
        {canManage && open && !cancelling && <button type="button" className="button button--quiet" onClick={() => setCancelling(true)}>Cancel the class</button>}
        {canManage && course.competency_key && eligible.length > 0 && <button type="button" className="button" disabled={!!busy} onClick={() => void recordTickets()}>Record {eligible.length} ticket{eligible.length === 1 ? '' : 's'}</button>}
      </div>
      {canManage && open && seats === 0 && !booking && <p className="caption">The class is full.</p>}

      {booking && (
        <div className="item">
          <p className="label">Book someone on this class</p>
          <div className="signin__grid">
            <Field label="Who" wide>
              <select className="field field--sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
                <option value="__other">Someone else…</option>
              </select>
            </Field>
            {pick === '__other' && <Field label="Their name, as on the sheets" wide><input className="field field--sm" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>}
          </div>
          <div className="photo-add-pair">
            <button type="button" className="button" disabled={!!busy} onClick={() => void book()}>{busy === 'book' ? 'Booking…' : 'Book'}</button>
            <button type="button" className="button button--quiet" onClick={() => setBooking(false)}>Cancel</button>
          </div>
        </div>
      )}
      {cancelling && (
        <div className="item">
          <p className="label">Cancel this class</p>
          <Field label="Why" wide><input className="field field--sm" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Trainer unavailable, not enough booked…" /></Field>
          <div className="photo-add-pair">
            <button type="button" className="button" disabled={!!busy} onClick={() => void setClass('cancelled')}>Cancel the class</button>
            <button type="button" className="button button--quiet" onClick={() => setCancelling(false)}>Keep it</button>
          </div>
        </div>
      )}
      {tickets && (tickets.recorded.length > 0 || tickets.skipped.length > 0) && (
        <p className="caption">
          {tickets.recorded.length > 0 && <>Recorded: {tickets.recorded.map((r) => r.person).join(', ')}. </>}
          {tickets.skipped.length > 0 && <>Not recorded: {tickets.skipped.map((s) => `${s.person} (${s.why})`).join('; ')}.</>}
        </p>
      )}

      <h2 style={{ marginTop: '1.25rem' }}>On the class · {attendees.length}</h2>
      <div className="regs__list">
        {sorted.length === 0 && <p className="caption">Nobody booked yet.</p>}
        {sorted.map((a) => {
          const h = attendedHours(a, cls, course);
          const tone = a.status === 'attended' ? (a.result === 'fail' ? ' regs__fact--warn' : ' regs__fact--ok') : a.status === 'absent' ? ' regs__fact--bad' : '';
          const ticket = course.competency_key ? (recorded.has(a.id) ? 'ticket recorded' : a.status === 'attended' && a.result === 'pass' ? 'ticket not yet recorded' : null) : null;
          return (
            <article key={a.id} className={`card regs__row${a.status === 'withdrawn' ? ' regs__row--retired' : ''}`}>
              <div className="regs__head">
                <div className="regs__title">
                  <p className="regs__name">{a.person_name}</p>
                  <p className={`caption regs__meta regs__fact${tone}`}><span className="regs__fact-text">{ATTENDEE_STATUS_LABEL[a.status]}</span>{a.status === 'attended' ? ` · ${h == null ? 'hours not recorded' : `${h} h`}${a.result ? ` · ${RESULT_LABEL[a.result]}` : course.competency_key ? ' · result not marked' : ''}` : ''}{ticket ? ` · ${ticket}` : ''}{a.notes ? ` · ${a.notes}` : ''}</p>
                </div>
                {canManage && a.status === 'booked' && cls.status !== 'cancelled' && marking !== a.id && <button type="button" className="button button--quiet regs__edit" onClick={() => { setMarking(a.id); setResult(''); setHours(''); setNote(''); }}>Mark</button>}
              </div>
              {marking === a.id && (
                <div className="item" style={{ marginTop: '0.5rem' }}>
                  <div className="signin__grid">
                    {course.competency_key && <Field label="Result"><select className="field field--sm" value={result} onChange={(e) => setResult(e.target.value as '' | Result)}><option value="">Not assessed</option><option value="pass">{RESULT_LABEL.pass}</option><option value="fail">{RESULT_LABEL.fail}</option></select></Field>}
                    <Field label="Hours (blank = the class's)"><input className="field field--sm" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
                    <Field label="Note" wide><input className="field field--sm" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  </div>
                  <div className="photo-add-pair">
                    <button type="button" className="button" disabled={!!busy || !started} title={started ? undefined : 'The class has not started yet'} onClick={() => void mark(a, 'attended')}>Attended</button>
                    <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => void mark(a, 'absent')}>Absent</button>
                    <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => void mark(a, 'withdrawn')}>Withdrawn</button>
                    <button type="button" className="button button--quiet" onClick={() => setMarking(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
