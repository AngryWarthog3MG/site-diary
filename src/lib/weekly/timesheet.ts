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
