import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Progress over time: percent-complete per area, whole of project, from the
 * signed record's work items. One point per area per day (the day's highest
 * figure); areas without percentages simply don't chart.
 */

export interface AreaSeries {
  area: string;
  points: Array<{ date: string; percent: number; entry_no: string }>;
  latest: number;
  latestDate: string;
}

export interface ProgressData {
  series: AreaSeries[];
  charted: AreaSeries[];
  dates: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ProgressLoadError extends Error {}

/** No more than five lines on the chart — the rest live in the table. */
export const MAX_CHARTED = 5;

export async function loadProgressData(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProgressData> {
  if (!UUID_RE.test(projectId)) throw new ProgressLoadError('Bad project id.');

  const { data, error } = await supabase.rpc(
    'run_diary_query',
    {
      p_sql:
        `select entry_no, entry_date, area, percent_complete from diary.work_items ` +
        `where project_id = '${projectId}' and area is not null and percent_complete is not null ` +
        `order by entry_date`,
      p_limit: 1000,
    },
    { get: true },
  );
  if (error) throw new ProgressLoadError(`Could not read the diary: ${error.message}`);
  const rows = ((data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []);

  const byArea = new Map<string, Map<string, { percent: number; entry_no: string }>>();
  for (const row of rows) {
    const area = String(row.area).trim();
    const date = String(row.entry_date);
    const percent = Math.max(0, Math.min(100, Number(row.percent_complete)));
    const days = byArea.get(area) ?? new Map();
    const existing = days.get(date);
    if (!existing || percent > existing.percent) {
      days.set(date, { percent, entry_no: String(row.entry_no) });
    }
    byArea.set(area, days);
  }

  const series: AreaSeries[] = [...byArea.entries()]
    .map(([area, days]) => {
      const points = [...days.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({ date, percent: v.percent, entry_no: v.entry_no }));
      const last = points[points.length - 1];
      return { area, points, latest: last.percent, latestDate: last.date };
    })
    // Behind-first in the table; identity order for the chart is set below.
    .sort((a, b) => a.latest - b.latest || a.area.localeCompare(b.area));

  // Chart the most recently active areas; hue follows the AREA (stable sort
  // by name for colour assignment so a filter or new data never repaints).
  const charted = [...series]
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate) || b.points.length - a.points.length)
    .slice(0, MAX_CHARTED)
    .sort((a, b) => a.area.localeCompare(b.area));

  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  return { series, charted, dates };
}
