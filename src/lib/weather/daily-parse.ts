/**
 * The Bureau's daily climate table for one station and one month
 * (product IDCKWCDEA0, e.g. `perth_metro-202609.csv`): one row per calendar
 * day with maximum, minimum, rain and average wind.
 *
 * Column conventions, which are the Bureau's and matter for what a row means:
 *   - Maximum on row D is the daytime maximum of D.
 *   - Minimum on row D is the overnight minimum ending the morning of D.
 *   - Rain on row D is the 24 hours to 09:00 on D — so the rain that fell on
 *     the site day D is on row D+1. `dailyForDay` does that shift so callers
 *     never have to.
 *   - Wind is the day's average 10 m speed in m/s; converted to km/h here.
 *
 * Pure and unit tested. The FTP fetch lives in `daily.ts`.
 */

export interface DailyClimateRow {
  /** ISO date YYYY-MM-DD. */
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  /** mm in the 24 hours to 09:00 on `date`. */
  rainTo9am: number | null;
  /** Average 10 m wind, km/h, rounded to whole. */
  windAvgKmh: number | null;
}

/** The daily table's figures for one site day, already shifted to that day. */
export interface DailyForDay {
  temp_max: number | null;
  temp_min: number | null;
  /** mm in the 24 hours from 09:00 on the day — `rainTo9am` of the next row. */
  rainfall_mm: number | null;
  wind_kmh: number | null;
}

function num(cell: string | undefined): number | null {
  if (cell == null) return null;
  const trimmed = cell.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function isoFromAu(cell: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseDailyClimate(csv: string): DailyClimateRow[] {
  const lines = csv.split(/\r?\n/);
  const headerAt = lines.findIndex((line) => /^Station Name,Date,/i.test(line));
  if (headerAt < 1) return [];

  // Two header lines: the one above names the quantity, the header row names
  // the window/unit. Find columns by the pair so a reordered table still reads.
  const above = lines[headerAt - 1].split(',').map((s) => s.trim());
  const header = lines[headerAt].split(',').map((s) => s.trim());
  const col = (want: (a: string, h: string) => boolean): number =>
    header.findIndex((h, i) => want(above[i] ?? '', h));

  const dateCol = header.findIndex((h) => /^date$/i.test(h));
  const rainCol = col((a) => /^rain/i.test(a));
  const maxCol = col((a, h) => /^maximum$/i.test(a) && /^temperature$/i.test(h));
  const minCol = col((a, h) => /^minimum$/i.test(a) && /^temperature$/i.test(h));
  const windCol = col((a, h) => /wind/i.test(a) && /^speed$/i.test(h));
  if (dateCol < 0) return [];

  const rows: DailyClimateRow[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = line.split(',');
    const date = cells[dateCol] ? isoFromAu(cells[dateCol]) : null;
    if (!date) continue;
    const windMs = windCol >= 0 ? num(cells[windCol]) : null;
    rows.push({
      date,
      tempMax: maxCol >= 0 ? num(cells[maxCol]) : null,
      tempMin: minCol >= 0 ? num(cells[minCol]) : null,
      rainTo9am: rainCol >= 0 ? num(cells[rainCol]) : null,
      windAvgKmh: windMs == null ? null : Math.round(windMs * 3.6),
    });
  }
  return rows;
}

/** ISO date one day after `iso`, by calendar arithmetic (no timezone). */
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/**
 * What the daily table says about site day `day`, or null when it has nothing
 * yet. Max and min come from that day's row; rain from the next day's row,
 * because that is the 24 hours that started at 09:00 on `day`.
 */
export function dailyForDay(rows: readonly DailyClimateRow[], day: string): DailyForDay | null {
  const own = rows.find((r) => r.date === day);
  const after = rows.find((r) => r.date === nextDay(day));
  if (!own && !after) return null;
  const out: DailyForDay = {
    temp_max: own?.tempMax ?? null,
    temp_min: own?.tempMin ?? null,
    rainfall_mm: after?.rainTo9am ?? null,
    wind_kmh: own?.windAvgKmh ?? null,
  };
  return out.temp_max == null && out.temp_min == null && out.rainfall_mm == null && out.wind_kmh == null
    ? null
    : out;
}

/** The daily table's folder for a state product: IDW60920 → 'wa'. */
export function stateFolder(productId: string): string | null {
  const letter = /^ID([DNQSTVW])60920$/.exec(productId)?.[1];
  const map: Record<string, string> = { D: 'nt', N: 'nsw', Q: 'qld', S: 'sa', T: 'tas', V: 'vic', W: 'wa' };
  return letter ? map[letter] ?? null : null;
}

/**
 * The Bureau names a station's folder after the station: 'PERTH METRO' →
 * 'perth_metro'. Brackets and punctuation are dropped, which is what their
 * own listing does ('KOOLAN ISLAND (KOOLAN CENTRAL AIRPORT)' aside — those
 * simply do not have a daily table, and the fetch says so).
 */
export function stationSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** YYYYMM for every month touching [from, to] plus the day after `to`. */
export function monthsCovering(from: string, to: string): string[] {
  const end = nextDay(to);
  const out: string[] = [];
  let cursor = from.slice(0, 7);
  while (cursor <= end.slice(0, 7)) {
    out.push(cursor.replace('-', ''));
    const [y, m] = cursor.split('-').map(Number);
    cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  }
  return out;
}
