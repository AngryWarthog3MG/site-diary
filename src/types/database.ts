// Database types.
//
// Regenerate from the live schema with:  npm run db:types
// (that overwrites this file with `supabase gen types typescript --local`).
// Hand-written here so step 1 compiles before a local stack is running; the
// enums and the tables auth touches are complete and match the migrations.

export type MemberRole    = 'supervisor' | 'pm' | 'admin';
export type EntryStatus   = 'draft' | 'signed';
export type HireType      = 'wet' | 'dry';
export type DelayCategory = 'weather' | 'access' | 'design' | 'other';
export type WeatherSource = 'bom_auto' | 'manual';
export type Confidence    = 'high' | 'low';
export type KeywordCategory = 'person' | 'plant' | 'area' | 'supplier' | 'other';
export type EntrySection  =
  | 'labour' | 'plant' | 'work_items' | 'variations' | 'delays' | 'weather';
export type SectionState  = 'gap' | 'captured' | 'nil_confirmed';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organisation {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  code: string;
  site_lat: number | null;
  site_lng: number | null;
  /** Pins a BOM station by WMO or BOM id. Nearest to the site when null. */
  bom_station_id: string | null;
  /** BOM state observation product, e.g. IDW60920. Inferred from coordinates when null. */
  bom_product_id: string | null;
  principal_contractor: string | null;
  active: boolean;
  next_entry_seq: number;
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
}

export interface Entry {
  id: string;
  project_id: string;
  /** Issued at signing, not at draft creation. Null while status is 'draft'. */
  entry_seq: number | null;
  entry_no: string | null;
  entry_date: string;
  author_id: string;
  status: EntryStatus;
  signed_at: string | null;
  signed_by: string | null;
  content_hash: string | null;
  audio_url: string | null;
  transcript_raw: string | null;
  supersedes_entry_id: string | null;
  created_at: string;
}

export interface Weather {
  entry_id: string;
  temp_max: number | null;
  temp_min: number | null;
  rainfall_mm: number | null;
  wind_dir: string | null;
  wind_kmh: number | null;
  source: WeatherSource;
  observed_impact: string | null;
  /** Provenance: which gauge, how far away, over what window, fetched when. */
  station_id: string | null;
  station_name: string | null;
  station_distance_km: number | null;
  observed_from: string | null;
  observed_to: string | null;
  fetched_at: string | null;
  created_at: string;
}

/**
 * One Bureau reading per project per day, kept whether or not a diary was
 * written (`project_weather_days`). A glance and a gap-filler, never the
 * signed record. Written only by the server.
 */
export interface ProjectWeatherDay {
  project_id: string;
  day: string;
  temp_max: number | null;
  temp_min: number | null;
  /** mm in the 24 h from 09:00 (bom_daily), or since 09:00 so far (bom_obs). */
  rainfall_mm: number | null;
  wind_dir: string | null;
  wind_kmh: number | null;
  source: 'bom_daily' | 'bom_obs';
  station_id: string | null;
  station_name: string | null;
  fetched_at: string;
}

export interface Daywork {
  id: string;
  entry_id: string;
  description: string;
  labour: string | null;
  plant: string | null;
  materials: string | null;
  hours: number | null;
  docket_ref: string | null;
  photo_urls: string[];
  source_quote: string | null;
  confidence: Confidence | null;
  created_at: string;
}
