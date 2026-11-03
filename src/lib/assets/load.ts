import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assetVerdict, type AssetRow, type AssetVerdict, type CheckoutFacts, type DoneFacts, type MeterFacts, type ProfileRow,
} from './model';

/**
 * The asset register under the caller's RLS (README R186): every asset of the
 * company through the `asset_register` view, its profiles, what has been done
 * against them on either records table, every meter reading from any source,
 * and who has what. One gather; the verdicts are the model's.
 */

export interface AssetRegisterData {
  verdicts: AssetVerdict[];
  profiles: ProfileRow[];
  done: DoneFacts[];
  readings: Map<string, MeterFacts[]>;
  checkouts: CheckoutFacts[];
}

type RawProfile = ProfileRow & { every_hours: number | string | null; start_hours: number | string | null };
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

export async function loadAssetRegister(supabase: SupabaseClient, orgId: string, today: string, only?: { assetId?: string }): Promise<AssetRegisterData> {
  const assetsQ = supabase.from('asset_register').select('id, org_id, plant_id, asset_class, name, asset_no, barcode, category, make_model, serial_no, ownership, supplier, hire_ref, location, purchased_on, notes, active, retired_reason').eq('org_id', orgId);
  const profilesQ = supabase.from('asset_profiles').select('id, asset_id, kind, label, basis, every, unit, first_due_on, every_hours, start_hours, assigned_to, priority, active, notes').eq('org_id', orgId);
  const checkoutsQ = supabase.from('asset_checkouts').select('id, asset_id, holder_name, out_at, due_back_on, in_at, project:projects(code)').eq('org_id', orgId).is('in_at', null);
  const [{ data: assetRows, error }, { data: profileRows }, { data: checkoutRows }] = await Promise.all([
    only?.assetId ? assetsQ.eq('id', only.assetId) : assetsQ,
    only?.assetId ? profilesQ.eq('asset_id', only.assetId) : profilesQ,
    only?.assetId ? checkoutsQ.eq('asset_id', only.assetId) : checkoutsQ,
  ]);
  if (error) throw new Error(`Could not read the asset register: ${error.message}`);
  const assets = (assetRows ?? []) as AssetRow[];
  const profiles: ProfileRow[] = ((profileRows ?? []) as RawProfile[]).map((p) => ({ ...p, every_hours: num(p.every_hours), start_hours: num(p.start_hours) }));
  const assetIds = assets.map((a) => a.id);
  const plantIds = assets.map((a) => a.plant_id).filter((v): v is string => Boolean(v));
  const byPlant = new Map(assets.filter((a) => a.plant_id).map((a) => [a.plant_id as string, a.id]));

  const [{ data: recs }, { data: plantRecs }, { data: meterRows }, { data: prestartRows }] = await Promise.all([
    assetIds.length ? supabase.from('asset_records').select('asset_id, profile_id, done_on, next_due_on, meter_reading').in('asset_id', assetIds) : Promise.resolve({ data: [] as unknown[] }),
    plantIds.length ? supabase.from('plant_maintenance_records').select('plant_id, profile_id, done_on, next_due_on, hour_meter').in('plant_id', plantIds) : Promise.resolve({ data: [] as unknown[] }),
    assetIds.length ? supabase.from('asset_meter_readings').select('asset_id, read_on, reading').in('asset_id', assetIds) : Promise.resolve({ data: [] as unknown[] }),
    plantIds.length ? supabase.from('plant_prestarts').select('plant_id, prestart_date, hour_meter').in('plant_id', plantIds).not('hour_meter', 'is', null).not('completed_at', 'is', null) : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const done: DoneFacts[] = [];
  const readings = new Map<string, MeterFacts[]>();
  const add = (assetId: string, r: MeterFacts) => readings.set(assetId, [...(readings.get(assetId) ?? []), r]);
  for (const r of (recs ?? []) as Array<{ asset_id: string; profile_id: string | null; done_on: string; next_due_on: string | null; meter_reading: number | string | null }>) {
    done.push({ profile_id: r.profile_id, done_on: r.done_on, next_due_on: r.next_due_on, meter: num(r.meter_reading) });
    if (r.meter_reading != null) add(r.asset_id, { reading: Number(r.meter_reading), read_on: r.done_on, source: 'service' });
  }
  for (const r of (plantRecs ?? []) as Array<{ plant_id: string; profile_id: string | null; done_on: string; next_due_on: string | null; hour_meter: number | string | null }>) {
    done.push({ profile_id: r.profile_id, done_on: r.done_on, next_due_on: r.next_due_on, meter: num(r.hour_meter) });
    const assetId = byPlant.get(r.plant_id);
    if (assetId && r.hour_meter != null) add(assetId, { reading: Number(r.hour_meter), read_on: r.done_on, source: 'service' });
  }
  for (const r of (meterRows ?? []) as Array<{ asset_id: string; read_on: string; reading: number | string }>) add(r.asset_id, { reading: Number(r.reading), read_on: r.read_on, source: 'reading' });
  for (const r of (prestartRows ?? []) as Array<{ plant_id: string; prestart_date: string; hour_meter: number | string }>) {
    const assetId = byPlant.get(r.plant_id);
    if (assetId) add(assetId, { reading: Number(r.hour_meter), read_on: r.prestart_date, source: 'prestart' });
  }
  const checkouts: CheckoutFacts[] = ((checkoutRows ?? []) as Array<{ id: string; asset_id: string; holder_name: string; out_at: string; due_back_on: string | null; in_at: string | null; project: { code: string } | { code: string }[] | null }>)
    .map((c) => ({ id: c.id, asset_id: c.asset_id, holder_name: c.holder_name, out_at: c.out_at, due_back_on: c.due_back_on, in_at: c.in_at, project_code: (Array.isArray(c.project) ? c.project[0]?.code : c.project?.code) ?? null }));

  const verdicts = assets.map((a) => assetVerdict(a, profiles, done, readings.get(a.id) ?? [], checkouts, today));
  return { verdicts, profiles, done, readings, checkouts };
}
