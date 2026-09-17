import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { rainPrompts } from '@/lib/environment/model';
import { EnvironmentScreen, type AspectRow, type LegalRow, type EvaluationRow, type MonitoringRow, type Criteria, type JobSettings } from './environment-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Environment · KBS Daily Diary' };

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Environmental management for this job and the company (README R73): what ISO
 * 14001 asks to be maintained — aspects and impacts judged against set criteria,
 * the legal register and how each obligation applies — the evaluations of
 * compliance, monitoring results, and the checks heavy rain calls for. The
 * incident clocks live on the environmental incident itself.
 */
export default async function EnvironmentPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'environment')) redirect(`/?project=${current.project_id}`);
  guardScreen(current, 'environment');

  const supabase = await createClient();
  const org = current.project.org.id;
  const p = current.project_id;
  const today = perthToday();
  const [
    { data: settings }, { data: criteria }, { data: aspects }, { data: applies }, { data: legal }, { data: links },
    { data: evaluations }, { data: monitoring }, { data: equipment }, { data: weather }, { data: checks }, { data: schedules },
  ] = await Promise.all([
    supabase.from('projects').select('env_report_hours_serious, env_report_hours_minor, env_investigation_days, env_rain_inspection_mm').eq('id', p).single(),
    supabase.from('env_significance_criteria').select('id, version, method, threshold, issued_at').eq('org_id', org).order('version', { ascending: false }).limit(1),
    supabase.from('env_aspects').select('id, activity, aspect, impact, condition, likelihood, consequence, score, significant, controls, active, reviewed_at, criteria_id').eq('org_id', org).order('significant', { ascending: false }).order('score', { ascending: false }),
    supabase.from('project_env_aspects').select('aspect_id, applies, note').eq('project_id', p),
    supabase.from('env_legal_obligations').select('id, project_id, title, source_type, reference, requirement, how_applies, active, reviewed_at').eq('org_id', org).or(`project_id.is.null,project_id.eq.${p}`).order('title'),
    supabase.from('env_obligation_aspects').select('obligation_id, aspect_id'),
    supabase.from('compliance_evaluations').select('id, project_id, evaluated_on, evaluator_name, status, summary').eq('org_id', org).or(`project_id.is.null,project_id.eq.${p}`).order('evaluated_on', { ascending: false }),
    supabase.from('env_monitoring_records').select('id, monitored_on, kind, location, parameter, value, unit, limit_value, limit_kind, outcome, action_taken, method, notes').eq('project_id', p).order('monitored_on', { ascending: false }).limit(60),
    supabase.from('measuring_equipment').select('id, name').eq('org_id', org).eq('active', true).order('name'),
    supabase.from('project_weather_days').select('day, rainfall_mm').eq('project_id', p).gte('day', addDays(today, -15)),
    supabase.from('inspections').select('inspection_date').eq('project_id', p).eq('kind', 'environmental').not('completed_at', 'is', null).gte('inspection_date', addDays(today, -15)),
    supabase.from('obligations').select('id, project_id, title').eq('org_id', org).eq('kind', 'compliance_evaluation').eq('active', true).or(`project_id.is.null,project_id.eq.${p}`),
  ]);

  const jobSettings = (settings ?? { env_report_hours_serious: null, env_report_hours_minor: null, env_investigation_days: null, env_rain_inspection_mm: null }) as JobSettings;
  const prompts = rainPrompts(
    ((weather ?? []) as Array<{ day: string; rainfall_mm: number | string | null }>).map((w) => ({ day: w.day, rainfall_mm: w.rainfall_mm == null ? null : Number(w.rainfall_mm) })),
    ((checks ?? []) as Array<{ inspection_date: string }>).map((c) => c.inspection_date),
    jobSettings.env_rain_inspection_mm == null ? null : Number(jobSettings.env_rain_inspection_mm),
    today,
  );
  const applyMap = new Map(((applies ?? []) as Array<{ aspect_id: string; applies: boolean; note: string | null }>).map((a) => [a.aspect_id, a]));
  const linkRows = (links ?? []) as Array<{ obligation_id: string; aspect_id: string }>;

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Environment</h1>
      <p className="page-subtitle">
        How the work affects the environment and which effects matter, the laws and contract clauses that apply and how, whether
        the job complies, what was measured, and the checks heavy rain calls for.
      </p>
      <OutboxStatus />
      <EnvironmentScreen
        orgId={org}
        projectId={p}
        today={today}
        canManage={canAuthorEntries(current.role)}
        canRecord={canRunTalks(current.role)}
        isAdmin={current.role === 'admin'}
        settings={jobSettings}
        criteria={((criteria ?? [])[0] as Criteria | undefined) ?? null}
        aspects={((aspects ?? []) as Omit<AspectRow, 'appliesHere' | 'note'>[]).map((a) => ({ ...a, appliesHere: applyMap.get(a.id)?.applies ?? null, note: applyMap.get(a.id)?.note ?? null }))}
        legal={((legal ?? []) as Omit<LegalRow, 'aspectIds'>[]).map((o) => ({ ...o, aspectIds: linkRows.filter((l) => l.obligation_id === o.id).map((l) => l.aspect_id) }))}
        evaluations={(evaluations ?? []) as EvaluationRow[]}
        monitoring={(monitoring ?? []) as MonitoringRow[]}
        equipment={(equipment ?? []) as Array<{ id: string; name: string }>}
        schedules={(schedules ?? []) as Array<{ id: string; project_id: string | null; title: string }>}
        rainPrompts={prompts}
      />
    </main>
  );
}
