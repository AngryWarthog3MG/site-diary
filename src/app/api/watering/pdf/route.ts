import { loadWateringWeek } from '@/lib/watering/load';
import { dmy, readWeek } from '@/lib/watering/model';
import { wateringRegisterDoc } from '@/lib/registers/watering';
import { registerContext, registerPdf } from '@/lib/registers/respond';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** One week of the job's watering register (README R190), in the registers' layout. Returned, never stored. */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'watering');
  if (!ctx) return response;
  const monday = readWeek(new URL(request.url).searchParams.get('week') ?? undefined, ctx.today);
  const data = await loadWateringWeek(ctx.supabase, ctx.project.id, monday);
  const doc = wateringRegisterDoc({ monday, today: ctx.today, areas: data.areas, entries: data.entries, days: data.days, closed: data.closed });
  return registerPdf(doc, ctx, { slug: 'watering', scope: `${ctx.project.code} ${ctx.project.name} · week of ${dmy(monday)}` });
}
