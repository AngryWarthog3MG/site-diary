import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { registerInForce, notBriefed } from '@/lib/asbestos/model';
import { AsbestosScreen, type RegisterRow, type RemovalRow } from './asbestos-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Asbestos · KBS Daily Diary' };

/**
 * Asbestos on this workplace: the register in force — usually received from
 * whoever has management or control of the site — its management plan, who on
 * the crew has been briefed on it, and any licensed removal.
 * WHS (General) Regulations 2022 (WA) regs 425, 429, 466.
 */
export default async function AsbestosPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'asbestos')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const [{ data: regs }, { data: removals }, { data: crew }] = await Promise.all([
    supabase.from('asbestos_registers').select('id, status, duty_holder, register_date, reference, summary, asbestos_present, file_path, plan_file_path, plan_date, superseded_by, built_after_2003, none_identified, none_likely, asbestos_acknowledgements(id, person_name, briefed_on)').eq('project_id', current.project_id).order('register_date', { ascending: false }),
    supabase.from('asbestos_removals').select('id, location, friable, area_m2, removalist, licence_class, licence_no, emergency, notified_worksafe_on, notification_reference, work_start_on, clearance_certificate').eq('project_id', current.project_id).order('work_start_on', { ascending: false }),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
  ]);
  const registers = (regs ?? []) as RegisterRow[];
  const inForce = registerInForce(registers);
  const crewNames = ((crew ?? []) as Array<{ name: string }>).map((c) => c.name);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Asbestos</h1>
      <p className="page-subtitle">
        The register for this workplace — usually the principal contractor&rsquo;s or the owner&rsquo;s, received and kept here —
        its management plan, the crew briefed on it, and any removal.
      </p>
      <AsbestosScreen
        projectId={current.project_id}
        registers={registers}
        inForceId={inForce?.id ?? null}
        notBriefed={inForce ? notBriefed(crewNames, inForce.asbestos_acknowledgements.map((a) => a.person_name)) : []}
        removals={current.role === 'labourer' ? [] : (removals ?? []) as RemovalRow[]}
        today={perthToday()}
        canManage={canAuthorEntries(current.role)}
        canBrief={canRunTalks(current.role)}
      />
    </main>
  );
}
