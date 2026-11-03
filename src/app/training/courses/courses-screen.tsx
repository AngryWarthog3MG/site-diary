'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { COURSE_KINDS, COURSE_KIND_LABEL, PROVIDERS, courseProblems, type CourseKind, type CourseRow, type Provider } from '@/lib/training/courses';
import { Fold } from '@/components/fold';
import { Field, Messages, blankToNull, readMonths, useSave } from '../../registers/shared';

interface Props { orgId: string; courses: CourseRow[]; competencies: Array<{ key: string; label: string }>; classesPerCourse: Record<string, number>; canManage: boolean }

/** The catalogue on screen: live courses as cards, retired ones folded, one form to add or edit (README R188). */
export function CoursesScreen({ orgId, courses, competencies, classesPerCourse, canManage }: Props) {
  const [editing, setEditing] = useState<CourseRow | 'new' | null>(null);
  const live = courses.filter((c) => c.active);
  const retired = courses.filter((c) => !c.active);
  const label = (key: string | null) => (key ? competencies.find((c) => c.key === key)?.label ?? key : null);
  return (
    <div className="regs">
      {canManage && (editing
        ? <CourseForm orgId={orgId} course={editing === 'new' ? null : editing} competencies={competencies} onDone={() => setEditing(null)} />
        : <button type="button" className="button" style={{ marginTop: '1rem' }} onClick={() => setEditing('new')}>Add a course</button>)}
      <div className="regs__list" style={{ marginTop: '1rem' }}>
        {live.length === 0 && <p className="caption">No courses yet. Add the inductions, licences and VOCs the company runs or sends people to.</p>}
        {live.map((c) => <CourseCard key={c.id} course={c} ticket={label(c.competency_key)} classes={classesPerCourse[c.id] ?? 0} onEdit={canManage ? () => setEditing(c) : null} />)}
      </div>
      {retired.length > 0 && (
        <Fold label="Retired courses" count={retired.length}>
          <div className="regs__list">{retired.map((c) => <CourseCard key={c.id} course={c} ticket={label(c.competency_key)} classes={classesPerCourse[c.id] ?? 0} onEdit={canManage ? () => setEditing(c) : null} />)}</div>
        </Fold>
      )}
    </div>
  );
}

function CourseCard({ course: c, ticket, classes, onEdit }: { course: CourseRow; ticket: string | null; classes: number; onEdit: (() => void) | null }) {
  return (
    <article className={`card regs__row${c.active ? '' : ' regs__row--retired'}`}>
      <div className="regs__head">
        <div className="regs__title">
          <p className="regs__name"><span className="mono">{c.code}</span> · {c.name}</p>
          <p className="caption regs__meta">
            {COURSE_KIND_LABEL[c.kind]}{c.unit_of_competency ? ` · ${c.unit_of_competency}` : ''}{c.duration_hours != null ? ` · ${c.duration_hours} h` : ''}{c.expiry_months ? ` · current ${c.expiry_months} months` : ' · does not lapse'}
            {' · '}{c.provider === 'external' ? `provider ${c.provider_name ?? ''}` : 'in-house'}{ticket ? ` · earns ${ticket}` : ' · earns no ticket'}{classes ? ` · ${classes} class${classes === 1 ? '' : 'es'}` : ''}{c.active ? '' : ' · retired'}
          </p>
          {c.notes && <p className="caption">{c.notes}</p>}
        </div>
        {onEdit && <button type="button" className="button button--quiet regs__edit" onClick={onEdit}>Edit</button>}
      </div>
    </article>
  );
}

function CourseForm({ orgId, course, competencies, onDone }: { orgId: string; course: CourseRow | null; competencies: Array<{ key: string; label: string }>; onDone: () => void }) {
  const { busy, error, notice, run, setError } = useSave();
  const [code, setCode] = useState(course?.code ?? '');
  const [name, setName] = useState(course?.name ?? '');
  const [kind, setKind] = useState<CourseKind>(course?.kind ?? 'internal');
  const [uoc, setUoc] = useState(course?.unit_of_competency ?? '');
  const [duration, setDuration] = useState(course?.duration_hours != null ? String(course.duration_hours) : '');
  const [expiry, setExpiry] = useState(course?.expiry_months != null ? String(course.expiry_months) : '');
  const [provider, setProvider] = useState<Provider>(course?.provider ?? 'internal');
  const [providerName, setProviderName] = useState(course?.provider_name ?? '');
  const [competency, setCompetency] = useState(course?.competency_key ?? '');
  const [notes, setNotes] = useState(course?.notes ?? '');
  const [active, setActive] = useState(course?.active ?? true);

  const draft = () => ({
    code: code.trim(), name: name.trim(), kind, unit_of_competency: blankToNull(uoc),
    duration_hours: duration.trim() ? Number(duration) : null, expiry_months: readMonths(expiry),
    provider, provider_name: blankToNull(providerName), competency_key: competency || null, notes: blankToNull(notes), active,
  });
  async function save() {
    const d = draft();
    if (duration.trim() && !Number.isFinite(d.duration_hours)) { setError('Duration is a number of hours.'); return; }
    if (expiry.trim() && d.expiry_months == null) { setError('Expiry is 1 to 120 months, or blank.'); return; }
    const problems = courseProblems(d, new Set(competencies.map((c) => c.key)));
    if (problems.length) { setError(problems.join(' ')); return; }
    const done = await run('course', async () => {
      const supabase = createClient();
      const { error: e } = course
        ? await supabase.from('training_courses').update(d).eq('id', course.id)
        : await supabase.from('training_courses').insert({ org_id: orgId, ...d });
      if (e) throw new Error(/training_courses_code_once/i.test(e.message) ? 'That code is already a course.' : e.message);
      return course ? 'Course updated.' : 'Course added.';
    });
    if (done) onDone();
  }
  return (
    <div className="item" style={{ marginTop: '1rem' }}>
      <p className="label">{course ? `Edit ${course.code}` : 'New course'}</p>
      <div className="signin__grid">
        <Field label="Code"><input className="field field--sm mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="VOC-EXC" /></Field>
        <Field label="Name" wide><input className="field field--sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Excavator verification of competency" /></Field>
        <Field label="Kind"><select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as CourseKind)}>{COURSE_KINDS.map((k) => <option key={k} value={k}>{COURSE_KIND_LABEL[k]}</option>)}</select></Field>
        <Field label="Unit of competency"><input className="field field--sm mono" value={uoc} onChange={(e) => setUoc(e.target.value)} placeholder="RIIMPO320F" /></Field>
        <Field label="Duration (hours)"><input className="field field--sm" inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Stays current for (months)"><input className="field field--sm" inputMode="numeric" value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="blank = does not lapse" /></Field>
        <Field label="Provider"><select className="field field--sm" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>{PROVIDERS.map((p) => <option key={p} value={p}>{p === 'internal' ? 'In-house' : 'External'}</option>)}</select></Field>
        {provider === 'external' && <Field label="Provider's name"><input className="field field--sm" value={providerName} onChange={(e) => setProviderName(e.target.value)} /></Field>}
        <Field label="Ticket it earns"><select className="field field--sm" value={competency} onChange={(e) => setCompetency(e.target.value)}><option value="">None</option>{competencies.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
        <Field label="Notes" wide><input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {course && <label className="regs__tick"><input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} /> Retired — no new classes</label>}
      </div>
      <Messages error={error} notice={notice} />
      <div className="photo-add-pair">
        <button type="button" className="button" disabled={!!busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="button button--quiet" disabled={!!busy} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
