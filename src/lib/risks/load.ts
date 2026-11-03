import type { SupabaseClient } from '@supabase/supabase-js';
import { readMatrix, reviewDue, reviewStatus, summariseRisks, type ControlRow, type Matrix, type ProfileRow, type ReviewStatus, type RiskRow, type RiskSummary } from './model';

/**
 * The risk register under the caller's RLS (README R187): the company's
 * profiles — the company's own, this job's, and its assets' — each with its
 * risks and their controls, the matrix the company rates on, and when each
 * profile is next due a review. One gather; the verdicts are the model's.
 */

export interface ProfileVerdict {
  profile: ProfileRow;
  projectCode: string | null;
  assetName: string | null;
  lastReviewedOn: string | null;
  reviewDue: string | null;
  reviewStatus: ReviewStatus;
  summary: RiskSummary;
}

export interface RiskRegisterData {
  matrix: Matrix;
  /** True when the company has set its own cells. */
  matrixOwn: boolean;
  matrixNote: string | null;
  verdicts: ProfileVerdict[];
  risks: RiskRow[];
  controls: ControlRow[];
}

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

export async function loadRiskRegister(supabase: SupabaseClient, orgId: string, today: string, only?: { profileId?: string; projectId?: string }): Promise<RiskRegisterData> {
  let profilesQ = supabase.from('risk_profiles').select('id, org_id, scope, project_id, asset_id, name, description, originator_name, assessor_name, owner_name, status, review_interval_months, made_current_at, archived_at, archived_reason, created_at, project:projects(code), asset:assets(name, plant:plant_register(name))').eq('org_id', orgId);
  if (only?.profileId) profilesQ = profilesQ.eq('id', only.profileId);
  // A job's view: the company's profiles, this job's, and every asset's — never another job's.
  if (only?.projectId) profilesQ = profilesQ.or(`project_id.is.null,project_id.eq.${only.projectId}`);
  const [{ data: profileRows, error }, { data: matrixRow }] = await Promise.all([
    profilesQ.order('created_at', { ascending: false }),
    supabase.from('org_risk_matrices').select('cells, note').eq('org_id', orgId).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not read the risk register: ${error.message}`);
  type Raw = ProfileRow & { project: { code: string } | { code: string }[] | null; asset: { name: string | null; plant: { name: string } | { name: string }[] | null } | Array<{ name: string | null; plant: { name: string } | { name: string }[] | null }> | null };
  const raw = (profileRows ?? []) as unknown as Raw[];
  const ids = raw.map((p) => p.id);
  const [{ data: riskRows }, { data: reviewRows }] = await Promise.all([
    ids.length ? supabase.from('risks').select('id, org_id, profile_id, seq, task, step, hazard, hazard_type, unwanted_event, inherent_likelihood, inherent_consequence, inherent_level, residual_likelihood, residual_consequence, residual_level, potential_likelihood, potential_consequence, potential_level, critical, owner_name, assigned_to, status, closed_at, closed_reason, source_swms_id, source_step, notes, created_at').in('profile_id', ids).order('seq') : Promise.resolve({ data: [] as unknown[] }),
    ids.length ? supabase.from('risk_profile_reviews').select('profile_id, reviewed_on').in('profile_id', ids) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const risks = (riskRows ?? []) as RiskRow[];
  const riskIds = risks.map((r) => r.id);
  const { data: controlRows } = riskIds.length
    ? await supabase.from('risk_controls').select('id, risk_id, description, level, kind, critical, status, due_on, priority, owner_name, assigned_to, in_place_at, in_place_note, withdrawn_at, withdrawn_reason, created_at').in('risk_id', riskIds).order('created_at')
    : { data: [] as unknown[] };
  const controls = (controlRows ?? []) as ControlRow[];

  const lastReview = new Map<string, string>();
  for (const r of (reviewRows ?? []) as Array<{ profile_id: string; reviewed_on: string }>) {
    const have = lastReview.get(r.profile_id);
    if (!have || r.reviewed_on > have) lastReview.set(r.profile_id, r.reviewed_on);
  }
  const verdicts: ProfileVerdict[] = raw.map(({ project, asset, ...p }) => {
    const a = Array.isArray(asset) ? asset[0] : asset;
    const plant = a ? (Array.isArray(a.plant) ? a.plant[0] : a.plant) : null;
    const last = lastReview.get(p.id) ?? null;
    const profile: ProfileRow = { ...p, review_interval_months: num(p.review_interval_months) ?? 12 };
    const due = reviewDue(profile, last);
    return {
      profile,
      projectCode: (Array.isArray(project) ? project[0]?.code : project?.code) ?? null,
      assetName: a ? (a.name ?? plant?.name ?? null) : null,
      lastReviewedOn: last,
      reviewDue: due,
      reviewStatus: reviewStatus(due, today),
      summary: summariseRisks(risks.filter((r) => r.profile_id === p.id), controls, today),
    };
  });
  return {
    matrix: readMatrix(matrixRow?.cells ?? null),
    matrixOwn: Boolean(matrixRow),
    matrixNote: (matrixRow?.note as string | null) ?? null,
    verdicts, risks, controls,
  };
}
