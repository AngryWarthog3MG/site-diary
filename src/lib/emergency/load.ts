import type { SupabaseClient } from '@supabase/supabase-js';
import { currentPlan, nextDrillDue, lastDrill } from './model';

export interface EmergencyPlan {
  id: string;
  version: number;
  muster_point: string;
  site_address: string | null;
  nearest_hospital: string | null;
  emergency_contacts: string | null;
  first_aiders: string[];
  first_aid_location: string | null;
  fire_equipment_location: string | null;
  evacuation_procedure: string;
  notify_procedure: string | null;
  spill_response: string | null;
  site_hazards: string | null;
  test_every_months: number;
  training_note: string | null;
  issued_at: string;
  issued_by: string | null;
}

export interface EmergencyDrill {
  id: string;
  plan_id: string;
  held_on: string;
  scenario: string;
  participants: number | null;
  muster_minutes: number | null;
  went_well: string | null;
  to_improve: string | null;
  created_at: string;
  conducted_by: string | null;
}

export interface EmergencyData {
  plans: EmergencyPlan[];
  current: EmergencyPlan | null;
  /** Empty for anyone who does not read the record — the labourer reads the plan, not the drills. */
  drills: EmergencyDrill[];
  nextDrillDue: string | null;
  lastDrillOn: string | null;
}

const PLAN_COLUMNS =
  'id, version, muster_point, site_address, nearest_hospital, emergency_contacts, first_aiders, first_aid_location, fire_equipment_location, evacuation_procedure, notify_procedure, spill_response, site_hazards, test_every_months, training_note, issued_at, issued_by';

/** The plan for one workplace, every version of it, and its drills — under the caller's RLS. */
export async function loadEmergency(supabase: SupabaseClient, projectId: string): Promise<EmergencyData> {
  const [{ data: planRows }, { data: drillRows }] = await Promise.all([
    supabase.from('emergency_plans').select(PLAN_COLUMNS).eq('project_id', projectId).order('version', { ascending: false }),
    supabase.from('emergency_drills').select('id, plan_id, held_on, scenario, participants, muster_minutes, went_well, to_improve, created_at, conducted_by').eq('project_id', projectId).order('held_on', { ascending: false }),
  ]);
  const plans = ((planRows ?? []) as EmergencyPlan[]).map((p) => ({ ...p, first_aiders: p.first_aiders ?? [] }));
  const drills = ((drillRows ?? []) as Array<EmergencyDrill & { muster_minutes: number | string | null }>)
    .map((d) => ({ ...d, muster_minutes: d.muster_minutes == null ? null : Number(d.muster_minutes) }));
  const current = currentPlan(plans);
  return {
    plans,
    current,
    drills,
    nextDrillDue: current ? nextDrillDue(current, drills) : null,
    lastDrillOn: lastDrill(drills)?.held_on ?? null,
  };
}

/** Just the plan in force — what the labourer's home shows. */
export async function loadCurrentPlan(supabase: SupabaseClient, projectId: string): Promise<EmergencyPlan | null> {
  const { data } = await supabase.from('emergency_plans').select(PLAN_COLUMNS).eq('project_id', projectId)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  return data ? ({ ...(data as EmergencyPlan), first_aiders: (data as EmergencyPlan).first_aiders ?? [] }) : null;
}
