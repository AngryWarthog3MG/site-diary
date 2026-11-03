import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadRiskRegister } from '@/lib/risks/load';
import { canAssess } from '@/lib/risks/model';
import { RisksScreen } from './risks-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk register · Kooboolong IMS' };

/**
 * The risk register (README R187): the company's risk profiles, this job's and its assets' — each a
 * set of risks rated inherent, residual and potential on the company's matrix, with the controls that
 * stand between the hazard and the event. Read under the caller's RLS; the labourer has no door here.
 */
export default async function RisksPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  guardScreen(current, 'risks');
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const [data, { data: assetRows }] = await Promise.all([
    loadRiskRegister(supabase, org.id, today, { projectId: current.project_id }),
    supabase.from('asset_register').select('id, name, asset_no').eq('org_id', org.id).eq('active', true).order('name'),
  ]);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Risk register</h1>
      <p className="page-subtitle">
        Each profile is one assessment — the company&rsquo;s, this job&rsquo;s, or an asset&rsquo;s. A risk on it is a task, a
        hazard and what could go wrong, rated before controls, with the controls in place, and with the planned ones too.
        A planned control is an action until it is in place.
      </p>
      <RisksScreen
        orgId={org.id}
        projectId={current.project_id}
        jobCode={current.project.code}
        userId={userId}
        today={today}
        data={data}
        assets={((assetRows ?? []) as Array<{ id: string; name: string; asset_no: string | null }>)}
        canAssessJob={canAssess(current.role, 'project')}
        isOffice={canAssess(current.role, 'company')}
      />
    </main>
  );
}
