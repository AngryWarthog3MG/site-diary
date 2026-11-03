import { fail, ok, requireApiUser, isUuid, readJson } from '@/lib/api';
import { loadTraining } from '@/lib/training/load';
import { ticketBlocker, ticketDates } from '@/lib/training/courses';

export const runtime = 'nodejs';

/**
 * The class's one tap (README R188): a `crew_tickets` row for each attendance marked competent that has none yet —
 * or exactly the attendees named in the body. Written under the caller's RLS (`crew_tickets_write_managers` decides
 * who keeps tickets) and checked by the database (`app.crew_tickets_class_link`: attended, competent, this person,
 * this course earns that competency, the same company; one ticket per attendance). The class never writes it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return fail('bad_request', 'Bad class id.', 400);
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = (await readJson(request)) ?? {};
  const only = Array.isArray(body.attendeeIds) ? new Set((body.attendeeIds as unknown[]).filter(isUuid)) : null;

  const { data: cls } = await supabase.from('training_classes').select('id, org_id').eq('id', id).maybeSingle();
  if (!cls) return fail('not_found', 'That class is not on your company.', 404);
  const data = await loadTraining(supabase, cls.org_id as string, { classId: id });
  const klass = data.classes[0];
  const course = data.courses.find((c) => c.id === klass?.course_id);
  if (!klass || !course) return fail('not_found', 'That class is not on your company.', 404);
  if (!course.competency_key) return fail('bad_request', 'This course earns no ticket.', 400);

  const recorded: Array<{ attendeeId: string; ticketId: string; person: string }> = [];
  const skipped: Array<{ attendeeId: string; person: string; why: string }> = [];
  for (const a of data.attendees) {
    if (only && !only.has(a.id)) continue;
    const why = ticketBlocker(a, course, data.ticketsByAttendee.has(a.id));
    if (why) { skipped.push({ attendeeId: a.id, person: a.person_name, why }); continue; }
    const dates = ticketDates(klass, course);
    const { data: row, error } = await supabase
      .from('crew_tickets')
      .insert({
        org_id: klass.org_id, person_name: a.person_name, ticket_type: course.competency_key, class_attendee_id: a.id, created_by: user.id,
        issued_on: dates.issued_on, expires_on: dates.expires_on,
        notes: `${course.code} ${course.name} — class of ${dates.issued_on}${klass.trainer_name ? `, ${klass.trainer_name}` : ''}`,
      })
      .select('id')
      .single();
    if (error) {
      if (/row-level security/i.test(error.message)) return fail('forbidden', 'Only someone who keeps the company\'s tickets records one.', 403);
      skipped.push({ attendeeId: a.id, person: a.person_name, why: /crew_tickets_class_once/i.test(error.message) ? 'Ticket already recorded.' : error.message });
      continue;
    }
    recorded.push({ attendeeId: a.id, ticketId: row.id as string, person: a.person_name });
  }
  return ok({ recorded, skipped, label: course.competency_key });
}
