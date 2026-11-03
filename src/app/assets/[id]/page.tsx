import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isUuid } from '@/lib/api';
import { loadAssetRegister } from '@/lib/assets/load';
import { loadJobPeople } from '@/lib/members/people';
import { CLASS_LABEL, categoryLabel, type AssetRecordKind, type Outcome } from '@/lib/assets/model';
import { AssetScreen, type AssetRecordRow, type CheckoutRow, type OpenAction } from './asset-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Asset · Kooboolong IMS' };

/**
 * One asset (README R186): its facts, what falls due on it and when, every inspection, test and
 * service on record, its meter, and who has it now and had it before. A machine's inspections and
 * maintenance stay on the machine's page (reg. 237) — this page points there.
 */
export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'assets');

  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  const data = await loadAssetRegister(supabase, org.id, today, { assetId: id });
  const verdict = data.verdicts[0];
  if (!verdict || verdict.asset.org_id !== org.id) notFound();

  const [{ data: records }, { data: history }, { data: actions }, people] = await Promise.all([
    supabase.from('asset_records').select('id, profile_id, kind, done_on, performed_by_name, competence, organisation, meter_reading, outcome, findings, next_due_on, file_path, created_at').eq('asset_id', id).order('done_on', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('asset_checkouts').select('id, holder_name, purpose, due_back_on, out_at, condition_out, in_at, condition_in, project:projects(code)').eq('asset_id', id).order('out_at', { ascending: false }).limit(30),
    supabase.from('asset_actions').select('id, profile_id, due_on, action, detail, priority, assigned_to, done_at').eq('asset_id', id).is('done_at', null).order('due_on'),
    loadJobPeople(supabase, current.project_id),
  ]);
  // Who an action can go to: the job's members who have a door to the action register (R177: not the labourer).
  const jobs = memberships.filter((m) => m.project.active && m.project.org.id === org.id).map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name }));
  const a = verdict.asset;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">{a.name}</h1>
      <p className="page-subtitle">
        {[CLASS_LABEL[a.asset_class], categoryLabel(a), a.asset_no, a.make_model].filter(Boolean).join(' · ')}
        {!a.active && <> · <strong>Retired</strong></>}
      </p>
      <AssetScreen
        orgId={org.id}
        projectId={current.project_id}
        userId={userId}
        today={today}
        verdict={verdict}
        profiles={data.profiles}
        done={data.done}
        readings={data.readings.get(a.id) ?? []}
        records={((records ?? []) as Array<Omit<AssetRecordRow, 'meter_reading' | 'kind' | 'outcome'> & { meter_reading: number | string | null; kind: AssetRecordKind; outcome: Outcome | null }>)
          .map((r) => ({ ...r, meter_reading: r.meter_reading == null ? null : Number(r.meter_reading) }))}
        history={((history ?? []) as Array<Omit<CheckoutRow, 'project_code'> & { project: { code: string } | { code: string }[] | null }>)
          .map(({ project: p, ...c }) => ({ ...c, project_code: (Array.isArray(p) ? p[0]?.code : p?.code) ?? null }))}
        actions={(actions ?? []) as OpenAction[]}
        people={people}
        jobs={jobs}
        canManage={canRunTalks(current.role)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/assets?project=${current.project_id}`}>Back to assets</Link>
    </main>
  );
}
