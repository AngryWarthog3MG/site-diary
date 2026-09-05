/**
 * Percent complete by area across a week — the numbers behind the line
 * chart, kept apart from the drawing so the test runner can load them.
 * Only stated percentages count: a day nobody gave a figure for has no
 * point.
 */

export interface ProgressPoint {
  date: string;
  percent: number;
}

export interface ProgressSeries {
  area: string;
  points: ProgressPoint[];
  latest: number;
}

/** Same five hues as the Progress screen, in the same order. */
export const PROGRESS_PALETTE = ['#2e7d43', '#2f6fb0', '#b07d1a', '#c04a7c', '#6d4fc2'];
export const MAX_SERIES = 5;

export function buildProgressSeries(
  rows: Array<{ date: string; area: string | null; percent_complete: number | null }>,
  days: string[],
): ProgressSeries[] {
  // "Bus Port", "Bus port" and "Busport" are one area said three ways —
  // grouped by a spelling-blind key, shown under the most recent spelling.
  // Different words ("Road" against "Drive") stay apart; only the supervisor
  // knows whether those are the same place.
  const keyOf = (area: string) => area.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byArea = new Map<string, Map<string, number>>();
  const label = new Map<string, { area: string; date: string }>();
  for (const row of rows) {
    if (row.percent_complete == null || !row.area) continue;
    const spelt = row.area.trim();
    if (!spelt) continue;
    const area = keyOf(spelt);
    const seen = label.get(area);
    if (!seen || row.date >= seen.date) label.set(area, { area: spelt, date: row.date });
    const perDay = byArea.get(area) ?? new Map<string, number>();
    // Several items on one area in one day: the highest stated figure is
    // the day's position — a later item cannot undo progress an earlier
    // one recorded.
    perDay.set(row.date, Math.max(perDay.get(row.date) ?? 0, row.percent_complete));
    byArea.set(area, perDay);
  }
  const series: ProgressSeries[] = [];
  for (const [key, perDay] of byArea) {
    const points = days
      .filter((d) => perDay.has(d))
      .map((d) => ({ date: d, percent: perDay.get(d) as number }));
    if (points.length === 0) continue;
    series.push({ area: label.get(key)?.area ?? key, points, latest: points[points.length - 1].percent });
  }
  // Most recently active first, then by name, so the chart is stable from
  // one render to the next.
  series.sort((a, b) => {
    const la = a.points[a.points.length - 1].date;
    const lb = b.points[b.points.length - 1].date;
    return la === lb ? a.area.localeCompare(b.area) : la < lb ? 1 : -1;
  });
  return series.slice(0, MAX_SERIES);
}

