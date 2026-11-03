import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadAssetRegister } from '@/lib/assets/load';
import { AssetsScreen } from './assets-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assets & equipment · Kooboolong IMS' };

/**
 * Assets and equipment (README R186): everything the company owns or hires — the machines on
 * the plant register and all the rest — what is due on each, its meter and who has it.
 * Company-wide, read under the caller's RLS; the labourer has no door here.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ project?: string; q?: string; class?: string }> }) {
  const { memberships } = await requireUser();
  const { project, q, class: cls } = await searchParams;
  const current = resolveProject(memberships, project);
  guardScreen(current, 'assets');
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;

  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const [data, { data: links }] = await Promise.all([
    loadAssetRegister(supabase, org.id, today),
    supabase.from('project_plant').select('plant_id').eq('project_id', current.project_id).eq('active', true),
  ]);
  const onJobPlant = new Set((links ?? []).map((l) => l.plant_id as string));
  const onJob = data.verdicts.filter((v) => (v.asset.plant_id && onJobPlant.has(v.asset.plant_id)) || v.custody?.project_code === current.project.code).map((v) => v.asset.id);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Assets &amp; equipment</h1>
      <p className="page-subtitle">
        Extinguishers, first-aid kits, leads, slings, harnesses, hired gear and the machines — where each is, who has it,
        and what is due on it. A machine stays on the plant register; it is listed here with the rest.
      </p>
      <AssetsScreen
        orgId={org.id}
        projectId={current.project_id}
        jobCode={current.project.code}
        today={today}
        verdicts={data.verdicts}
        onJob={onJob}
        canManage={canRunTalks(current.role)}
        initialQuery={q ?? ''}
        initialClass={cls ?? ''}
      />
      <hr className="rule" />
      <p className="regs__links">
        <Link className="linklike" href={`/plant?project=${current.project_id}`}>Plant and prestarts</Link>
        <Link className="linklike" href={`/registers?project=${current.project_id}`}>The other registers</Link>
        <Link className="linklike" href={`/actions?project=${current.project_id}`}>Action register</Link>
      </p>
    </main>
  );
}
