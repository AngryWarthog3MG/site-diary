import type { DerivedWeather, StationObservation } from './types';

/**
 * Turning a BOM observation into a row of the daily record.
 *
 * All of the difficulty is in deciding whether a reading actually describes
 * the work day. BOM attaches a window to every element, and those windows move
 * through the day — at knock-off the "minimum air temperature" on the wire is
 * the *coming* night's, not this morning's. Recording it as the day's minimum
 * would be inventing a number, which the brief forbids outright, so a reading
 * whose window does not sit on the entry date is dropped and the field stays
 * null for the supervisor to fill in.
 *
 * Pure and side-effect free: everything here is unit tested.
 */

const EARTH_RADIUS_KM = 6371;

export interface SitePoint {
  lat: number;
  lon: number;
}

export function haversineKm(a: SitePoint, b: SitePoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local calendar date of a BOM local-time string ('2026-08-25T09:00:00+08:00'). */
function localDate(value: string | null): string | null {
  return value && value.length >= 10 ? value.slice(0, 10) : null;
}

function element(station: StationObservation, type: string) {
  return station.elements.find((e) => e.type === type) ?? null;
}

/** BOM ids carry leading zeros ('009225'); a supervisor may not type them. */
function idMatches(candidate: string | null, wanted: string): boolean {
  if (!candidate) return false;
  const strip = (v: string) => v.trim().replace(/^0+/, '').toLowerCase();
  return candidate.trim().toLowerCase() === wanted.trim().toLowerCase() ||
    strip(candidate) === strip(wanted);
}

export interface StationChoice {
  station: StationObservation;
  distanceKm: number;
}

/**
 * Whether a station reports weather a diary can use: temperature or rainfall.
 * Plenty of BOM stations are wind-only masts on pylons and buoys — a docket
 * quoting one records dashes for everything a claim would later reach for.
 */
export function reportsWeather(station: StationObservation): boolean {
  return ['rainfall', 'maximum_air_temperature', 'minimum_air_temperature'].some(
    (type) => element(station, type)?.value != null,
  );
}

/**
 * The station the record should quote: the one pinned on the project if it is
 * in this product, otherwise the closest to the site THAT ACTUALLY REPORTS
 * weather. The nearest gauge is worthless if it is a wind mast — Inner
 * Dolphin Pylon taught us that, 6.3 km from a site whose docket showed no
 * temperature and no rain. Only when no station in range reports anything
 * substantive does plain nearest win, so the refusal downstream can name it.
 */
export function pickStation(
  stations: readonly StationObservation[],
  site: SitePoint,
  pinnedId?: string | null,
): StationChoice | null {
  if (stations.length === 0) return null;

  if (pinnedId) {
    const pinned = stations.find(
      (s) => idMatches(s.wmoId, pinnedId) || idMatches(s.bomId, pinnedId),
    );
    if (pinned) {
      return { station: pinned, distanceKm: round1(haversineKm(site, pinned)) };
    }
  }

  let best: StationChoice | null = null;
  let bestReporting: StationChoice | null = null;
  for (const station of stations) {
    const distanceKm = haversineKm(site, station);
    if (!best || distanceKm < best.distanceKm) {
      best = { station, distanceKm };
    }
    if (reportsWeather(station) && (!bestReporting || distanceKm < bestReporting.distanceKm)) {
      bestReporting = { station, distanceKm };
    }
  }
  const chosen = bestReporting ?? best;
  return chosen ? { station: chosen.station, distanceKm: round1(chosen.distanceKm) } : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Derive the day's weather from one station's latest observation.
 *
 * `entryDate` is the local calendar date of the diary entry; `now` is when the
 * fetch happened. A field is only filled when the reading's window belongs to
 * that date and has actually elapsed.
 */
export function deriveWeather(
  choice: StationChoice,
  entryDate: string,
  now: Date,
): DerivedWeather {
  const { station, distanceKm } = choice;
  const nowMs = now.getTime();
  const windows: Array<[string, string]> = [];

  const accept = (type: string, rule: 'starts-on-day' | 'ended-on-day') => {
    const el = element(station, type);
    if (!el || el.value == null) return null;

    if (rule === 'starts-on-day') {
      // A running total or running maximum for the day: the window has to
      // open on the entry date.
      if (localDate(el.startLocal) !== entryDate) return null;
    } else {
      // A completed window — the overnight minimum that belongs to this
      // morning, not the one still ahead of us.
      if (localDate(el.endLocal) !== entryDate) return null;
      const end = el.endLocal ? Date.parse(el.endLocal) : Number.NaN;
      if (!Number.isFinite(end) || end > nowMs) return null;
    }

    if (el.startLocal && el.endLocal) windows.push([el.startLocal, el.endLocal]);
    return el.value;
  };

  const rainfall = accept('rainfall', 'starts-on-day');
  const tempMax = accept('maximum_air_temperature', 'starts-on-day');
  const tempMin = accept('minimum_air_temperature', 'ended-on-day');

  // Wind is instantaneous, so it counts only if the reading itself was taken
  // on the day being recorded.
  const observedOnDay = localDate(station.observedLocal) === entryDate;
  const windDir = observedOnDay ? (element(station, 'wind_dir')?.text ?? null) : null;
  const windKmh = observedOnDay ? (element(station, 'wind_spd_kmh')?.value ?? null) : null;

  if (observedOnDay && station.observedLocal && (windDir != null || windKmh != null)) {
    windows.push([station.observedLocal, station.observedLocal]);
  }

  const anything =
    rainfall != null || tempMax != null || tempMin != null || windDir != null || windKmh != null;

  const from = anything ? earliest(windows) : null;

  return {
    temp_max: tempMax,
    temp_min: tempMin,
    rainfall_mm: rainfall,
    wind_dir: windDir,
    wind_kmh: windKmh,
    station_id: station.wmoId ?? station.bomId,
    station_name: station.name,
    station_distance_km: distanceKm,
    observed_from: from,
    observed_to: anything ? clampToNow(latest(windows), from, now) : null,
  };
}

/**
 * BOM declares a running maximum's window as the whole daylight period —
 * 06:00 to 21:00 — whatever the time actually is. Storing that end verbatim
 * would have a diary signed at half five claiming observations up to nine, so
 * the window is cut back to the moment of the fetch.
 */
function clampToNow(end: string | null, from: string | null, now: Date): string | null {
  if (!end) return null;
  const endMs = Date.parse(end);
  const nowMs = now.getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return end;

  // Never let the clamp invert the window on a stale snapshot.
  const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  if (Number.isFinite(fromMs) && nowMs < fromMs) return from;

  return now.toISOString();
}

function earliest(windows: Array<[string, string]>): string | null {
  const starts = windows.map(([s]) => s).filter(Boolean);
  return starts.length ? starts.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
}

function latest(windows: Array<[string, string]>): string | null {
  const ends = windows.map(([, e]) => e).filter(Boolean);
  return ends.length ? ends.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
}

export function hasObservations(weather: DerivedWeather): boolean {
  return (
    weather.temp_max != null ||
    weather.temp_min != null ||
    weather.rainfall_mm != null ||
    weather.wind_dir != null ||
    weather.wind_kmh != null
  );
}

/**
 * Accumulate observations across the day.
 *
 * The Today screen and every sync refetch, so a supervisor who opens the app
 * at smoko and again at knock-off has given the record two looks at the
 * weather. Merging keeps what each one saw: this morning's minimum survives
 * even though BOM has long since moved that element on to tonight, and the
 * running maximum and rain total only ever go up.
 *
 * Readings from a different station are not merged — a maximum from one gauge
 * and a rain total from another is not an observation of anywhere.
 */
export function mergeWeather(
  existing: DerivedWeather | null,
  incoming: DerivedWeather,
): DerivedWeather {
  if (!existing) return incoming;
  if (existing.station_id && incoming.station_id && existing.station_id !== incoming.station_id) {
    return incoming;
  }

  return {
    // Running maximum for the day, so it only rises.
    temp_max: pickBy(existing.temp_max, incoming.temp_max, Math.max),
    // Both refer to the same completed overnight window, so this is idempotent.
    temp_min: pickBy(existing.temp_min, incoming.temp_min, Math.min),
    // Rainfall since 9am is monotonic.
    rainfall_mm: pickBy(existing.rainfall_mm, incoming.rainfall_mm, Math.max),
    // Instantaneous: the newer reading wins.
    wind_dir: incoming.wind_dir ?? existing.wind_dir,
    wind_kmh: incoming.wind_kmh ?? existing.wind_kmh,
    station_id: incoming.station_id ?? existing.station_id,
    station_name: incoming.station_name ?? existing.station_name,
    station_distance_km: incoming.station_distance_km ?? existing.station_distance_km,
    observed_from: earlierOf(existing.observed_from, incoming.observed_from),
    observed_to: laterOf(existing.observed_to, incoming.observed_to),
  };
}

function pickBy(
  a: number | null,
  b: number | null,
  combine: (x: number, y: number) => number,
): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return combine(a, b);
}

function earlierOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Which state product covers a set of coordinates.
 *
 * Deliberately coarse — state borders are not rectangles, and a site near one
 * may resolve to the wrong product. That is survivable because the caller
 * refuses any station further than a set distance from the site, and
 * `projects.bom_product_id` pins it permanently when it matters.
 */
export function inferProductId(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -39.2) return 'IDT60920'; // Tasmania
  if (lon < 129) return 'IDW60920'; // Western Australia
  if (lon < 138) return lat > -26 ? 'IDD60920' : 'IDS60920'; // NT above the border, SA below
  if (lon < 141) return 'IDS60920'; // South Australia
  if (lat > -29) return 'IDQ60920'; // Queensland
  if (lat < -35.9 && lon < 150) return 'IDV60920'; // Victoria
  return 'IDN60920'; // New South Wales and the ACT
}

export const BOM_PRODUCT_IDS = [
  'IDD60920',
  'IDN60920',
  'IDQ60920',
  'IDS60920',
  'IDT60920',
  'IDV60920',
  'IDW60920',
] as const;
