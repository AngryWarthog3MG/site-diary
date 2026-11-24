/**
 * The watering register on paper (README R190), in the R117 layout: one week — each day with its maximum temperature
 * and who recorded it, then an area a row and a day a column, then the notes. Every word in a cell is the
 * model's verdict — a recorded day with nothing on an area prints "Not watered", a day nobody recorded prints "Not
 * recorded", and hours nobody stated print as not recorded, never as a number.
 */
import {
  DAY_SHORT, METHOD_SHORT, areaHours, cellState, dm, dmy, fmtHours, indexEntries, entryKey, shownAreas, summariseWeek, weekDays,
  type WateringArea, type WateringClose, type WateringDay, type WateringEntry,
} from '../watering/model.ts';
import { fmtPerthDate } from '../pdf/dates.ts';
import type { Cell, RegisterDoc } from './model.ts';

const part = (method: string | null, hours: number | null) => (method ? `${METHOD_SHORT[method as keyof typeof METHOD_SHORT]} ${hours != null ? `${fmtHours(hours)} h` : '· hours not recorded'}` : '');

export function wateringRegisterDoc(input: {
  monday: string; today: string; areas: readonly WateringArea[]; entries: readonly WateringEntry[]; days: readonly WateringDay[]; closed: WateringClose | null;
}): RegisterDoc {
  const { monday, today, entries, days, closed } = input;
  const week = weekDays(monday);
  const inWeek = entries.filter((e) => week.includes(e.day));
  const areas = shownAreas(input.areas, inWeek);
  const byKey = indexEntries(inWeek);
  const dayRow = new Map(days.map((d) => [d.day, d]));
  const sum = summariseWeek(monday, today, inWeek, days);

  const rows: Cell[][] = areas.map((a) => {
    const lines = week.map((d) => byKey.get(entryKey(a.id, d)) ?? null);
    const cells = week.map((d, i): Cell => {
      const e = lines[i];
      const state = cellState(e, dayRow.has(d), d, today);
      if (state === 'ahead') return { text: '—' };
      if (state === 'not_recorded') return { text: 'Not recorded', tone: 'warn' };
      if (state === 'not_watered' || !e) return { text: 'Not watered' };
      const gap = (e.method && e.hours == null) || (e.supp_method && e.supp_hours == null);
      const main = part(e.method, e.hours);
      const supp = e.supp_method ? `Supplementary: ${part(e.supp_method, e.supp_hours)}` : '';
      return { text: main || supp, sub: main && supp ? supp : null, tone: gap ? 'warn' : 'none' };
    });
    const h = areaHours(lines.filter((l): l is WateringEntry => l != null));
    return [
      { text: a.name, sub: a.active ? null : 'retired' },
      ...cells,
      { text: h.any ? `${fmtHours(h.total)} h` : '—', sub: h.supp > 0 ? `incl. ${fmtHours(h.supp)} h supplementary` : null, tone: h.gaps ? 'warn' : 'none' },
    ];
  });

  const notes: Cell[][] = inWeek
    .filter((e) => (e.notes ?? '').trim())
    .sort((a, b) => a.day.localeCompare(b.day) || (areas.findIndex((x) => x.id === a.area_id) - areas.findIndex((x) => x.id === b.area_id)))
    .map((e) => [{ text: `${DAY_SHORT[week.indexOf(e.day)]} ${dm(e.day)}` }, { text: areas.find((a) => a.id === e.area_id)?.name ?? '—' }, { text: (e.notes ?? '').trim() }]);

  // The days that have come: the maximum temperature read on site, and who recorded the day.
  const recorded: Cell[][] = week.filter((d) => d <= today).map((d) => {
    const row = dayRow.get(d);
    return [
      { text: `${DAY_SHORT[week.indexOf(d)]} ${dmy(d)}` },
      row?.temp_max != null ? { text: `${row.temp_max.toFixed(1)} °C` } : row ? { text: 'Not read', tone: 'warn' as const } : { text: '—' },
      row ? { text: row.recorded_by_name ?? 'Name not kept' } : { text: 'Not recorded', tone: 'warn' as const },
      { text: row?.recorded_at ? fmtPerthDate(row.recorded_at) : '—' },
    ];
  });

  return {
    title: 'Watering register',
    basis: 'The record of watering by area and day as kept on site. Hours are the hours recorded and the maximum temperature is the one read on site: nothing is computed, estimated or carried forward. "Not watered" is a day that was recorded with nothing on the area; "Not recorded" is a day nobody recorded.',
    summary: [
      `Week of Monday ${dmy(monday)} to Sunday ${dmy(week[6])} · ${closed ? `closed ${fmtPerthDate(closed.closed_at)}${closed.closed_by_name ? ` by ${closed.closed_by_name}` : ''}` : 'open — still being recorded'}`,
      `${areas.length} area${areas.length === 1 ? '' : 's'} · ${fmtHours(sum.total)} hours of watering recorded${sum.supp > 0 ? ` (${fmtHours(sum.main)} h and ${fmtHours(sum.supp)} h supplementary)` : ''} · ${sum.recorded} of ${sum.due} day${sum.due === 1 ? '' : 's'} recorded${sum.hottest ? ` · hottest ${sum.hottest.temp.toFixed(1)} °C on ${DAY_SHORT[week.indexOf(sum.hottest.day)]} ${dm(sum.hottest.day)}` : ''}`,
      ...(sum.gaps ? [`${sum.gaps} watering line${sum.gaps === 1 ? '' : 's'} with no hours recorded — not counted in any total`] : []),
    ],
    sections: [
      { heading: 'Days', columns: ['Day', 'Maximum temperature', 'Recorded by', 'On'], rows: recorded, empty: 'No day of this week has come yet.' },
      { heading: 'Watering by area', columns: ['Area', ...week.map((d, i) => `${DAY_SHORT[i]} ${dm(d)}`), 'Week'], rows, empty: 'No areas on this job’s watering register.' },
      { heading: 'Notes', columns: ['Day', 'Area', 'Note'], rows: notes, empty: 'No notes this week.' },
    ],
    key: 'Amber is something still to be answered: a day nobody recorded, a temperature not read, or watering with no hours beside it.',
  };
}
