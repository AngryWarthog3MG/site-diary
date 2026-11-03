import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendeeRow, ClassRow, CourseRow } from './courses';

/**
 * Courses, classes and attendees under the caller's RLS (README R188): the
 * company's whole catalogue, every class (or one), the people on each, and
 * which attendances already have their ticket recorded. One gather; every
 * verdict is the model's.
 */

export interface TrainingData {
  courses: CourseRow[];
  classes: ClassRow[];
  attendees: AttendeeRow[];
  /** Attendee ids a `crew_tickets` row already names. */
  ticketsByAttendee: Set<string>;
  /** Job codes for the classes held on a job. */
  projectCodes: Map<string, string>;
}

export async function loadTraining(supabase: SupabaseClient, orgId: string, opts?: { classId?: string }): Promise<TrainingData> {
  const classQuery = supabase.from('training_classes').select('*').eq('org_id', orgId).order('starts_at');
  const [{ data: courses }, { data: classes }] = await Promise.all([
    supabase.from('training_courses').select('*').eq('org_id', orgId).order('code'),
    opts?.classId ? classQuery.eq('id', opts.classId) : classQuery,
  ]);
  const classRows = (classes ?? []) as ClassRow[];
  const ids = classRows.map((c) => c.id);
  const [{ data: attendees }, { data: tickets }, { data: projects }] = await Promise.all([
    ids.length ? supabase.from('training_class_attendees').select('*').in('class_id', ids).order('person_name') : Promise.resolve({ data: [] as AttendeeRow[] }),
    supabase.from('crew_tickets').select('class_attendee_id').eq('org_id', orgId).not('class_attendee_id', 'is', null),
    supabase.from('projects').select('id, code').eq('org_id', orgId),
  ]);
  return {
    courses: (courses ?? []) as CourseRow[],
    classes: classRows,
    attendees: (attendees ?? []) as AttendeeRow[],
    ticketsByAttendee: new Set(((tickets ?? []) as Array<{ class_attendee_id: string | null }>).map((t) => t.class_attendee_id).filter((v): v is string => !!v)),
    projectCodes: new Map(((projects ?? []) as Array<{ id: string; code: string }>).map((p) => [p.id, p.code])),
  };
}

/** The names a booking is picked from: the company's active staff, then anyone on a crew list — one spelling each. */
export async function loadBookableNames(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const [{ data: staff }, { data: crew }] = await Promise.all([
    supabase.from('staff').select('name').eq('org_id', orgId).eq('active', true),
    supabase.from('crew').select('name, project:projects!inner(org_id)').eq('project.org_id', orgId).eq('active', true),
  ]);
  const seen = new Map<string, string>();
  for (const r of [...((staff ?? []) as Array<{ name: string }>), ...((crew ?? []) as Array<{ name: string }>)]) {
    const name = r.name.replace(/\s+/g, ' ').trim();
    const k = name.toLowerCase();
    if (name && !seen.has(k)) seen.set(k, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
