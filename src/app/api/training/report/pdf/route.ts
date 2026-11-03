import { fail, isDate } from '@/lib/api';
import { loadTraining } from '@/lib/training/load';
import { trainingReport } from '@/lib/training/courses';
import { trainingReportDoc } from '@/lib/registers/training';
import { registerContext, registerPdf } from '@/lib/registers/respond';
import { defaultPeriod } from '@/lib/training/period';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** The training report over a period (README R188): completed training and hours, the whole company. Returned, never stored. */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'training');
  if (!ctx) return response;
  const url = new URL(request.url);
  const d = defaultPeriod(ctx.today);
  const from = url.searchParams.get('from') ?? d.from;
  const to = url.searchParams.get('to') ?? d.to;
  if (!isDate(from) || !isDate(to) || from > to) return fail('bad_request', 'The period is two days, the first not after the second.', 400);
  const data = await loadTraining(ctx.supabase, ctx.org.id);
  const report = trainingReport(data.attendees, data.classes, data.courses, data.ticketsByAttendee, from, to);
  const doc = trainingReportDoc(report, `the whole of ${ctx.org.name} · printed from ${ctx.project.code}`);
  return registerPdf(doc, ctx, { slug: 'training', scope: `${from} to ${to} · the whole company` });
}
