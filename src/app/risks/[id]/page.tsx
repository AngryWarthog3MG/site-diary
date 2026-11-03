import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isUuid } from '@/lib/api';
import { loadRiskRegister } from '@/lib/risks/load';
import { PROFILE_STATUS_LABEL, SCOPE_LABEL, canAssess } from '@/lib/risks/model';
import { readSteps } from '@/lib/swms/model';
import { loadJobPeople } from '@/lib/members/people';
import { ProfileScreen, type SwmsOption } from './profile-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk profile · Kooboolong IMS' };

/**
 * One risk profile (README R187): its facts and review, every risk on it with its three ratings and
 * its controls, and the job's active SWMS to bring steps in from. Writes go straight to the tables
 * under RLS — this is desk work, not a form filled in a trench, so there is no outbox here.
 */
export default async function RiskProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'risks');
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const data = await loadRiskRegister(supabase, org.id, today, { profileId: id });
  const verdict = data.verdicts[0];
  if (!verdict || verdict.profile.org_id !== org.id) notFound();
  const p = verdict.profile;
  // Another job's profile is read from its own job.
  if (p.scope === 'project' && p.project_id !== current.project_id) redirect(`/risks/${id}?project=${p.project_id}`);

  const [people, { data: causes }, { data: swmsRows }, { data: reviews }] = await Promise.all([
    loadJobPeople(supabase, current.project_id),
    supabase.from('org_incident_causes').select('kind, key, label, active').eq('org_id', org.id),
    supabase.from('swms').select('id, title, kind, version, steps').eq('project_id', current.project_id).eq('status', 'active').order('title'),
    supabase.from('risk_profile_reviews').select('id, reviewed_on, reviewed_by_name, note').eq('profile_id', id).order('reviewed_on', { ascending: false }).limit(20),
  ]);
  // Who a risk or a planned control can go to: the job's members with a door to the action register (R177: not the labourer).
  const swms: SwmsOption[] = ((swmsRows ?? []) as Array<{ id: string; title: string; kind: string; version: number; steps: unknown }>)
    .map((s) => ({ id: s.id, title: s.title, kind: s.kind, version: s.version, steps: readSteps(s.steps).map((st) => ({ step: st.step, hazards: st.hazards, risk_before: st.risk_before, controls: st.controls, risk_after: st.risk_after })) }));
  const where = p.scope === 'project' ? `Job ${verdict.projectCode ?? current.project.code}` : p.scope === 'asset' ? `Asset · ${verdict.assetName ?? ''}` : SCOPE_LABEL.company;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">{p.name}</h1>
      <p className="page-subtitle">{where} · {PROFILE_STATUS_LABEL[p.status]}{p.description ? ` · ${p.description}` : ''}</p>
      <ProfileScreen
        projectId={current.project_id}
        userId={userId}
        today={today}
        verdict={verdict}
        risks={data.risks}
        controls={data.controls}
        matrix={data.matrix}
        reviews={(reviews ?? []) as Array<{ id: string; reviewed_on: string; reviewed_by_name: string; note: string | null }>}
        people={people}
        hazardTypes={((causes ?? []) as Array<{ kind: string; key: string; label: string; active: boolean }>)}
        swms={swms}
        canWrite={canAssess(current.role, p.scope)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/risks?project=${current.project_id}`}>Back to the register</Link>
    </main>
  );
}
