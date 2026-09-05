import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchProduct } from './bom';
import { deriveWeather, hasObservations, inferProductId, pickStation, type StationChoice } from './derive';
import type { BomSnapshot, DerivedWeather, StationObservation } from './types';

/**
 * Resolving a project's weather: cache, station choice, and the honest refusals.
 */

/** BOM stations report every ten minutes or so; polling harder gains nothing. */
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

/**
 * Past this, the nearest gauge is not describing this site. Brief §2.4 —
 * better a null the app asks about than a number from the next valley.
 */
const MAX_STATION_DISTANCE_KM = 50;

export interface ProjectSite {
  id: string;
  site_lat: number | null;
  site_lng: number | null;
  bom_station_id: string | null;
  bom_product_id: string | null;
}

export type WeatherResolution =
  | { ok: true; weather: DerivedWeather; productId: string; stale: boolean }
  | { ok: false; reason: string };

async function loadSnapshot(productId: string): Promise<{ snapshot: BomSnapshot; stale: boolean }> {
  const admin = createAdminClient();

  const { data: cached } = await admin
    .from('bom_snapshots')
    .select('product_id, issued_at, fetched_at, stations')
    .eq('product_id', productId)
    .maybeSingle();

  const age = cached ? Date.now() - Date.parse(cached.fetched_at) : Number.POSITIVE_INFINITY;
  if (cached && age < SNAPSHOT_TTL_MS) {
    return {
      snapshot: {
        productId,
        issuedAt: cached.issued_at,
        stations: cached.stations as StationObservation[],
      },
      stale: false,
    };
  }

  try {
    const fresh = await fetchProduct(productId);
    await admin.from('bom_snapshots').upsert(
      {
        product_id: productId,
        issued_at: fresh.issuedAt,
        fetched_at: new Date().toISOString(),
        station_count: fresh.stations.length,
        stations: fresh.stations,
      },
      { onConflict: 'product_id' },
    );
    return { snapshot: fresh, stale: false };
  } catch (error) {
    // A cached product from twenty minutes ago still describes the day far
    // better than nothing does — but say so, so nobody mistakes it for live.
    if (cached) {
      return {
        snapshot: {
          productId,
          issuedAt: cached.issued_at,
          stations: cached.stations as StationObservation[],
        },
        stale: true,
      };
    }
    throw error;
  }
}

export type StationResolution =
  | { ok: true; choice: StationChoice; productId: string; stale: boolean }
  | { ok: false; reason: string };

/**
 * Which gauge speaks for this site: the pinned station if there is one, else
 * the nearest one reporting weather — and a refusal, not a guess, when the
 * nearest is too far away to be describing the site at all.
 */
export async function resolveStation(project: ProjectSite): Promise<StationResolution> {
  const { site_lat: lat, site_lng: lon } = project;
  if (lat == null || lon == null) {
    return { ok: false, reason: 'This project has no site coordinates, so weather cannot be fetched.' };
  }

  const productId = project.bom_product_id ?? inferProductId(lat, lon);
  if (!productId) {
    return { ok: false, reason: 'Could not work out which BOM product covers this site.' };
  }

  let snapshot: BomSnapshot;
  let stale: boolean;
  try {
    ({ snapshot, stale } = await loadSnapshot(productId));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'BOM is unreachable.' };
  }

  const choice = pickStation(snapshot.stations, { lat, lon }, project.bom_station_id);
  if (!choice) {
    return { ok: false, reason: `No stations reporting in ${productId}.` };
  }

  if (choice.distanceKm > MAX_STATION_DISTANCE_KM) {
    return {
      ok: false,
      reason:
        `The closest reporting station (${choice.station.name}) is ${choice.distanceKm} km from site — ` +
        'too far to record as this site’s weather. Pin a station on the project, or enter it by hand.',
    };
  }

  return { ok: true, choice, productId, stale };
}

export async function resolveWeather(
  project: ProjectSite,
  entryDate: string,
  now = new Date(),
): Promise<WeatherResolution> {
  const station = await resolveStation(project);
  if (!station.ok) return station;
  const { choice, productId, stale } = station;

  const weather = deriveWeather(choice, entryDate, now);
  if (!hasObservations(weather)) {
    return {
      ok: false,
      reason:
        `${choice.station.name} has nothing covering ${entryDate}. ` +
        'Observations only describe the current day, so a back-dated entry has to be filled in by hand.',
    };
  }

  return { ok: true, weather, productId, stale };
}

/** Loads the project a caller is allowed to see, under their own RLS. */
export async function loadProjectSite(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectSite | null> {
  const { data } = await supabase
    .from('projects')
    .select('id, site_lat, site_lng, bom_station_id, bom_product_id')
    .eq('id', projectId)
    .maybeSingle();
  return (data as ProjectSite | null) ?? null;
}

export { MAX_STATION_DISTANCE_KM };
