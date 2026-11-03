'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { classProblems, classStateText, classWhen, classWhenText, seatsLeft, sortClasses, type AttendeeRow, type ClassRow, type CourseRow } from '@/lib/training/courses';
import { Fold } from '@/components/fold';
import { Field, Messages, blankToNull, useSave } from '../../registers/shared';

export interface ClassesData { courses: CourseRow[]; classes: ClassRow[]; attendees: AttendeeRow[]; ticketsByAttendee: string[]; projectCodes: Record<string, string> }
interface Props { orgId: string; projectId: string; jobCode: string; today: string; data: ClassesData; canManage: boolean }

/** The classes on screen: coming up first, then run and not marked, held and cancelled folded; one form to schedule (README R188). */
export function ClassesScreen({ orgId, projectId, jobCode, today, data, canManage }: Props) {
  const [adding, setAdding] = useState(false);
  const course = useMemo(() => new Map(data.courses.map((c) => [c.id, c])), [data.courses]);
  const byClass = useMemo(() => {
    const m = new Map<string, AttendeeRow[]>();
    for (const a of data.attendees) m.set(a.class_id, [...(m.get(a.class_id) ?? []), a]);
    return m;
  }, [data.attendees]);
  const sorted = useMemo(() => sortClasses(data.classes), [data.classes]);
  const upcoming = sorted.filter((c) => c.status === 'scheduled' && classWhen(c, today) !== 'past');
  const unmarked = sorted.filter((c) => c.status === 'scheduled' && classWhen(c, today) === 'past').reverse();
  const held = sorted.filter((c) => c.status === 'held').reverse();
  const cancelled = sorted.filter((c) => c.status === 'cancelled').reverse();
  const q = `?project=${projectId}`;
  const card = (c: ClassRow) => {
    const k = course.get(c.course_id);
    const atts = byClass.get(c.id) ?? [];
    const booked = atts.filter((a) => a.status === 'booked').length;
    const came = atts.filter((a) => a.status === 'attended').length;
    const seats = seatsLeft(c, atts);
    const state = classStateText(c, today);
    const tone = c.status === 'cancelled' ? ' regs__fact--bad' : state === 'Run, not yet marked' ? ' regs__fact--warn' : state === 'Today' ? ' regs__fact--ok' : '';
    return (
      <article key={c.id} className={`card regs__row${c.status === 'cancelled' ? ' regs__row--retired' : ''}`}>
        <div className="regs__head">
          <div className="regs__title">
            <p className="regs__name"><Link href={`/training/classes/${c.id}${q}`}>{k ? `${k.code} · ${k.name}` : 'Course'}</Link></p>
            <p className="caption regs__meta">
              {classWhenText(c)}{c.venue ? ` · ${c.venue}` : ''}{c.trainer_name ? ` · ${c.trainer_name}` : ''}{c.project_id ? ` · job ${data.projectCodes[c.project_id] ?? ''}` : ' · the company'}
              {' · '}{c.status === 'held' ? `${came} attended` : `${booked} booked`}{seats != null && c.status === 'scheduled' ? ` · ${seats} seat${seats === 1 ? '' : 's'} left` : ''}
            </p>
            <p className={`regs__fact${tone}`}><span className="regs__fact-text">{state}{c.cancelled_reason ? ` — ${c.cancelled_reason}` : ''}</span></p>
          </div>
          <Link className="button button--quiet regs__edit" href={`/training/classes/${c.id}${q}`}>Open</Link>
        </div>
      </article>
    );
  };
  return (
    <div className="regs">
      {canManage && (adding
        ? <ClassForm orgId={orgId} projectId={projectId} jobCode={jobCode} courses={data.courses.filter((c) => c.active)} today={today} onDone={() => setAdding(false)} />
        : <button type="button" className="button" style={{ marginTop: '1rem' }} onClick={() => setAdding(true)} disabled={data.courses.filter((c) => c.active).length === 0} title={data.courses.filter((c) => c.active).length === 0 ? 'Add a course first' : undefined}>Schedule a class</button>)}
      {data.courses.filter((c) => c.active).length === 0 && <p className="caption" style={{ marginTop: '0.5rem' }}>No courses yet — <Link href={`/training/courses${q}`}>add one</Link> before scheduling a class.</p>}
      <h2 style={{ marginTop: "1.25rem" }}>Coming up</h2>
      <div className="regs__list">
        {upcoming.length === 0 && <p className="caption">Nothing scheduled.</p>}
        {upcoming.map(card)}
      </div>
      {unmarked.length > 0 && (<>
        <h2 style={{ marginTop: "1.25rem" }}>Run, not yet marked</h2>
        <div className="regs__list">{unmarked.map(card)}</div>
      </>)}
      {held.length > 0 && <Fold label="Held" count={held.length}><div className="regs__list">{held.map(card)}</div></Fold>}
      {cancelled.length > 0 && <Fold label="Cancelled" count={cancelled.length}><div className="regs__list">{cancelled.map(card)}</div></Fold>}
    </div>
  );
}

/** Perth clocks typed on the screen become instants: the class's day and hours are Perth's (README R77). */
export function perthInstant(day: string, clock: string): string { return `${day}T${clock}:00+08:00`; }

function ClassForm({ orgId, projectId, jobCode, courses, today, onDone }: { orgId: string; projectId: string; jobCode: string; courses: CourseRow[]; today: string; onDone: () => void }) {
  const { busy, error, notice, run, setError } = useSave();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [day, setDay] = useState(today);
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('');
  const [venue, setVenue] = useState('');
  const [trainer, setTrainer] = useState('');
  const [capacity, setCapacity] = useState('');
  const [where, setWhere] = useState<'job' | 'company'>('job');
  const [notes, setNotes] = useState('');
  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(start)) { setError('A day and a start time.'); return; }
    const d = {
      org_id: orgId, course_id: courseId, project_id: where === 'job' ? projectId : null,
      starts_at: perthInstant(day, start), ends_at: /^\d{2}:\d{2}$/.test(end) ? perthInstant(day, end) : null,
      venue: blankToNull(venue), trainer_name: blankToNull(trainer), capacity: capacity.trim() ? Number(capacity) : null, notes: blankToNull(notes),
    };
    const problems = classProblems(d);
    if (problems.length) { setError(problems.join(' ')); return; }
    const done = await run('class', async () => {
      const { error: e } = await createClient().from('training_classes').insert(d);
      if (e) throw new Error(e.message);
      return 'Class scheduled.';
    });
    if (done) onDone();
  }
  return (
    <div className="item" style={{ marginTop: '1rem' }}>
      <p className="label">Schedule a class</p>
      <div className="signin__grid">
        <Field label="Course" wide><select className="field field--sm" value={courseId} onChange={(e) => setCourseId(e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Day"><input className="field field--sm" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Starts (Perth)"><input className="field field--sm" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ends"><input className="field field--sm" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Venue"><input className="field field--sm" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Yard, site office, provider's rooms" /></Field>
        <Field label="Trainer"><input className="field field--sm" value={trainer} onChange={(e) => setTrainer(e.target.value)} /></Field>
        <Field label="Seats"><input className="field field--sm" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="blank = no cap" /></Field>
        <Field label="Held for"><select className="field field--sm" value={where} onChange={(e) => setWhere(e.target.value as 'job' | 'company')}><option value="job">This job ({jobCode})</option><option value="company">The company</option></select></Field>
        <Field label="Notes" wide><input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <Messages error={error} notice={notice} />
      <div className="photo-add-pair">
        <button type="button" className="button" disabled={!!busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Schedule'}</button>
        <button type="button" className="button button--quiet" disabled={!!busy} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
