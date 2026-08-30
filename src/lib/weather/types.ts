/** One AWS observation, as parsed out of a BOM state product. */
export interface StationObservation {
  wmoId: string | null;
  bomId: string | null;
  name: string;
  lat: number;
  lon: number;
  timezone: string | null;
  /** UTC timestamp of the observation period. */
  observedAt: string | null;
  /** The same instant in station-local time, with offset. */
  observedLocal: string | null;
  elements: ObservationElement[];
}

/**
 * A single measurement. BOM attaches the window each one covers, which is the
 * whole reason this is usable for a dated record: "rainfall 0.0 mm" means
 * nothing without knowing it covers 09:00 to 19:22 on a particular day.
 */
export interface ObservationElement {
  type: string;
  value: number | null;
  text: string | null;
  units: string | null;
  /** Local-time window, ISO 8601 with offset. Absent on instantaneous readings. */
  startLocal: string | null;
  endLocal: string | null;
}

export interface BomSnapshot {
  productId: string;
  issuedAt: string | null;
  stations: StationObservation[];
}

/** The subset of `public.weather` that comes from an observation. */
export interface DerivedWeather {
  temp_max: number | null;
  temp_min: number | null;
  rainfall_mm: number | null;
  wind_dir: string | null;
  wind_kmh: number | null;
  station_id: string | null;
  station_name: string | null;
  station_distance_km: number | null;
  observed_from: string | null;
  observed_to: string | null;
}
