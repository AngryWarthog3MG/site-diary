/**
 * Training on paper (README R188), in the R117 layout: a class's attendance
 * sheet — who was booked, who came, the hours and the result, with a column
 * to sign beside each name — and the training report over a period. Every
 * verdict is the model's; nothing is typed for the paper.
 */
import {
  ATTENDEE_STATUS_LABEL, CLASS_STATUS_LABEL, COURSE_KIND_LABEL, RESULT_LABEL, attendedHours, classStateText, classWhenText, seatsLeft,
  type AttendeeRow, type ClassRow, type CourseRow, type TrainingReport,
} from '../training/courses.ts';
import { fmtDay, type Cell, type RegisterDoc, type Tone } from './model.ts';

const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : '—');
const hoursText = (h: number | null) => (h == null ? 'not recorded' : `${h} h`);

export function classSheet(cls: ClassRow, course: CourseRow, attendees: readonly AttendeeRow[], ticketsByAttendee: ReadonlySet<string>, projectCode: string | null, today: string): RegisterDoc {
  const order: Record<string, number> = { attended: 0, booked: 1, absent: 2, withdrawn: 3 };
  const rows: Cell[][] = attendees.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.person_name.localeCompare(b.person_name)).map((a) => {
    const tone: Tone = a.status === 'attended' ? (a.result === 'fail' ? 'warn' : 'ok') : a.status === 'absent' ? 'bad' : 'none';
    return [
      { text: a.person_name },
      { text: ATTENDEE_STATUS_LABEL[a.status], tone },
      { text: a.status === 'attended' ? hoursText(attendedHours(a, cls, course)) : '—' },
      { text: a.result ? RESULT_LABEL[a.result] : a.status === 'attended' ? (course.competency_key ? 'not marked' : '—') : '—', tone: a.result === 'fail' ? 'warn' : 'none' },
      { text: ticketsByAttendee.has(a.id) ? 'Recorded' : course.competency_key ? '—' : 'n/a', tone: ticketsByAttendee.has(a.id) ? 'ok' : 'none' },
      { text: dash(a.notes) },
      { text: ' ' },
    ];
  });
  const seats = seatsLeft(cls, attendees);
  const came = attendees.filter((a) => a.status === 'attended').length;
  const booked = attendees.filter((a) => a.status === 'booked').length;
  return {
    title: `Training class — ${course.code} ${course.name}`,
    basis: 'WHS Act 2020 (WA) s. 19(3)(f) · WHS (General) Regs 2022 reg. 39 — information, training and instruction · ISO 45001 cl. 7.2 — competence · ISO 9001 cl. 7.2',
    summary: [
      `${classWhenText(cls)} · ${dash(cls.venue)} · trainer ${dash(cls.trainer_name)}${projectCode ? ` · job ${projectCode}` : ' · the company'} · ${classStateText(cls, today)}${cls.cancelled_reason ? ` — ${cls.cancelled_reason}` : ''}`,
      `${COURSE_KIND_LABEL[course.kind]}${course.unit_of_competency ? ` · ${course.unit_of_competency}` : ''}${course.duration_hours != null ? ` · ${course.duration_hours} h` : ''}${course.expiry_months ? ` · current ${course.expiry_months} months` : ' · does not lapse'} · ${course.provider === 'external' ? `provider ${dash(course.provider_name)}` : 'in-house'}`,
      `${attendees.length} on the sheet · ${came} attended · ${booked} booked${seats != null ? ` · ${seats} seat${seats === 1 ? '' : 's'} left of ${cls.capacity}` : ''}`,
    ],
    sections: [{
      heading: `${CLASS_STATUS_LABEL[cls.status]} · ${course.competency_key ? `earns the ${course.competency_key.replace(/_/g, ' ')} ticket` : 'earns no ticket'}`,
      columns: ['Name', 'Status', 'Hours', 'Result', 'Ticket', 'Notes', 'Signature'],
      rows,
      empty: 'Nobody booked.',
    }],
  };
}

export function trainingReportDoc(report: TrainingReport, scopeLine: string): RegisterDoc {
  const people: Cell[][] = report.people.map((p) => [
    { text: p.person_name },
    { text: String(p.lines) },
    { text: p.hours > 0 ? `${p.hours} h` : p.unrecorded > 0 ? 'not recorded' : '—', sub: p.unrecorded > 0 && p.hours > 0 ? `${p.unrecorded} without hours` : null, tone: p.unrecorded > 0 ? 'warn' : 'none' },
    { text: String(p.passed) },
    { text: String(p.failed), tone: p.failed > 0 ? 'warn' : 'none' },
  ]);
  const lines: Cell[][] = report.lines.map((l) => [
    { text: l.person_name },
    { text: fmtDay(l.day) },
    { text: `${l.course_code} ${l.course_name}`, sub: `${COURSE_KIND_LABEL[l.kind]}${l.unit_of_competency ? ` · ${l.unit_of_competency}` : ''}` },
    { text: l.provider === 'external' ? dash(l.provider_name) : dash(l.trainer_name) },
    { text: hoursText(l.hours), tone: l.hours == null ? 'warn' : 'none' },
    { text: l.result ? RESULT_LABEL[l.result] : '—', tone: l.result === 'fail' ? 'warn' : l.result === 'pass' ? 'ok' : 'none' },
    { text: l.ticketRecorded ? 'Recorded' : '—', tone: l.ticketRecorded ? 'ok' : 'none' },
  ]);
  return {
    title: 'Training report',
    basis: 'WHS Act 2020 (WA) s. 19(3)(f) · WHS (General) Regs 2022 reg. 39 · ISO 45001 cl. 7.2 and 9.1 · ISO 9001 cl. 7.2 — evidence of competence',
    summary: [
      `${fmtDay(report.from)} to ${fmtDay(report.to)} · ${scopeLine}`,
      `${report.attended} attendance${report.attended === 1 ? '' : 's'} by ${report.people.length} ${report.people.length === 1 ? 'person' : 'people'} · ${report.totalHours} hours recorded${report.unrecorded > 0 ? ` · ${report.unrecorded} attendance${report.unrecorded === 1 ? '' : 's'} with no hours recorded` : ''} · ${report.passed} competent · ${report.failed} not yet competent`,
    ],
    sections: [
      { heading: 'Hours by person', columns: ['Name', 'Attendances', 'Hours', 'Competent', 'Not yet'], rows: people, empty: 'No training attended in the period.' },
      { heading: 'Completed training', columns: ['Name', 'Day', 'Course', 'Trainer / provider', 'Hours', 'Result', 'Ticket'], rows: lines, empty: 'No training attended in the period.' },
    ],
  };
}
