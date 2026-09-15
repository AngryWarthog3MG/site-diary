import type { WeeklyData } from './load.ts';

/**
 * The timesheet CSV — the labour matrix from the weekly report, in the shape
 * payroll software expects. Signed entries only, like everything exported:
 * hours nobody signed for are not hours.
 *
 * Matrix layout, one row per person: name, role, one column per day (hours
 * including overtime, matching the weekly report's cells), then overtime and
 * total columns, and a closing daily-totals row.
 */

function csvField(value: string | number | null): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (cells: Array<string | number | null>): string => cells.map(csvField).join(',');

export function buildTimesheetCsv(data: WeeklyData): string {
  const lines: string[] = [];

  lines.push(
    row([
      `${data.project.orgCode}_${data.project.code} timesheet`,
      `${data.start} to ${data.end}`,
      'signed entries only',
    ]),
  );
  lines.push(row(['Name', 'Role', ...data.days, 'Overtime', 'Total']));

  for (const person of data.labour.people) {
    lines.push(
      row([
        person.name,
        person.role,
        ...data.days.map((day) => person.byDay[day] ?? null),
        person.overtime > 0 ? person.overtime : null,
        person.total,
      ]),
    );
  }

  lines.push(
    row([
      'Daily totals',
      null,
      ...data.days.map((day) => data.labour.dayTotals[day] ?? null),
      data.labour.overtimeTotal > 0 ? data.labour.overtimeTotal : null,
      data.labour.grandTotal,
    ]),
  );

  // CRLF: RFC 4180, and what spreadsheet imports expect.
  return lines.join('\r\n') + '\r\n';
}

export function timesheetFilename(data: WeeklyData): string {
  return `timesheet_${data.project.code}_${data.start}_${data.end}.csv`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayName(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * The payroll timesheet: one line per person per day worked, ordinary and
 * overtime hours in their own columns, the clocks the diary recorded, and the
 * diary serial the line stands on — the shape a bookkeeper imports or keys
 * into payroll without re-reading the matrix. Signed entries only, like the
 * matrix. Days with no hours are not lines: nothing is invented, not even a
 * zero. Sorted by person, then date.
 */
export function buildTimesheetLongCsv(data: WeeklyData): string {
  const lines: string[] = [];
  lines.push(row(['Job', 'Employee', 'Role', 'Date', 'Day', 'Start', 'Finish', 'Ordinary hours', 'Overtime hours', 'Total hours', 'Diary']));
  const job = `${data.project.orgCode}_${data.project.code}`;
  for (const person of data.labour.people) {
    for (const date of data.days) {
      const d = person.days[date];
      if (!d || d.ordinary + d.overtime <= 0) continue;
      lines.push(row([
        job, person.name, person.role, date, dayName(date), d.start, d.finish,
        d.ordinary > 0 ? d.ordinary : null, d.overtime > 0 ? d.overtime : null, Math.round((d.ordinary + d.overtime) * 100) / 100, d.ref,
      ]));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function timesheetLongFilename(data: WeeklyData): string {
  return `payroll_${data.project.code}_${data.start}_${data.end}.csv`;
}
