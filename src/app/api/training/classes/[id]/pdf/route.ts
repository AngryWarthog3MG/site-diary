import { fail, isUuid } from '@/lib/api';
import { loadTraining } from '@/lib/training/load';
import { classSheet } from '@/lib/registers/training';
import { registerContext, registerPdf } from '@/lib/registers/respond';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** A class's attendance sheet (README R188): who was booked, who came, hours, result, a column to sign. Returned, never stored. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return fail('bad_request', 'Bad class id.', 400);
  const { ctx, response } = await registerContext(request, 'training');
  if (!ctx) return response;
  const data = await loadTraining(ctx.supabase, ctx.org.id, { classId: id });
  const cls = data.classes[0];
  const course = data.courses.find((c) => c.id === cls?.course_id);
  if (!cls || !course) return fail('not_found', 'That class is not on your company.', 404);
  const doc = classSheet(cls, course, data.attendees, data.ticketsByAttendee, cls.project_id ? data.projectCodes.get(cls.project_id) ?? null : null, ctx.today);
  return registerPdf(doc, ctx, { slug: 'training-class', scope: `One class · ${course.code} · printed from ${ctx.project.code}` });
}
