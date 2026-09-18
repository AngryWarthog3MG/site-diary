import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { HealthScreen, type Program, type HealthRecord, type Keeper, type LeadNotice } from './health-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Health monitoring · Kooboolong IMS' };

/**
 * Health monitoring (WHS (General) Regulations 2022 (WA) Part 7.1 Div 6 and
 * Part 7.2). The reports are confidential: the database shows them only to the
 * organisation's named record keepers, whoever else opens this page. An admin
 * appoints keepers and sets up programmes, and reads no report unless they have
 * appointed themselves — which is recorded.
 */
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'health')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const org = current.project.org.id;
  const isAdmin = current.role === 'admin';
  const [{ data: programs }, { data: records }, { data: keepers }, { data: notices }, { data: members }, { data: ended }] = await Promise.all([
    supabase.from('health_monitoring_programs').select('id, hazard, basis, frequency_months, practitioner, active').eq('org_id', org).order('hazard'),
    // Under RLS: empty unless the viewer is a keeper — and only this company's, even for a keeper of two.
    supabase.from('health_monitoring_records').select('id, program_id, person_name, monitored_on, practitioner, result_summary, action_required, next_due_on, report_file_path, retain_until, program:health_monitoring_programs!inner(org_id)').eq('program.org_id', org).order('monitored_on', { ascending: false }),
    supabase.from('health_record_keepers').select('user_id, active, granted_at, revoked_at').eq('org_id', org),
    supabase.from('lead_risk_notifications').select('id, description, determined_on, notified_on, reference, project_id').eq('org_id', org).order('determined_on', { ascending: false }),
    isAdmin ? supabase.from('project_members').select('user_id').eq('project_id', current.project_id) : Promise.resolve({ data: [] }),
    supabase.from('health_monitoring_ended').select('id, program_id, person_name, ended_on, reason, program:health_monitoring_programs!inner(org_id)').eq('program.org_id', org),
  ]);
  const keeperRows = (keepers ?? []) as Array<{ user_id: string; active: boolean; granted_at: string; revoked_at: string | null }>;
  const ids = [...new Set([...keeperRows.map((k) => k.user_id), ...((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id)])];
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] };
  const name = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name ?? p.email ?? 'Someone']));
  const isKeeper = keeperRows.some((k) => k.user_id === userId && k.active);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Health monitoring</h1>
      <p className="page-subtitle">
        Confidential. Only the named health record keepers can read a monitoring report. It applies where a worker handles a
        Schedule 14 chemical, where a risk assessment shows a significant risk to health, for lead risk work, and for asbestos
        — not to all chemical work.
      </p>
      <HealthScreen
        orgId={org}
        projectId={current.project_id}
        isKeeper={isKeeper}
        isAdmin={isAdmin}
        canManagePrograms={canAuthorEntries(current.role)}
        programs={(programs ?? []) as Program[]}
        records={(records ?? []) as HealthRecord[]}
        keepers={keeperRows.map((k) => ({ ...k, name: name.get(k.user_id) ?? 'Someone' })) as Keeper[]}
        candidates={isAdmin ? ((members ?? []) as Array<{ user_id: string }>).map((m) => ({ id: m.user_id, name: name.get(m.user_id) ?? 'Someone' })) : []}
        notices={(notices ?? []) as LeadNotice[]}
        ended={((ended ?? []) as Array<{ id: string; program_id: string; person_name: string; ended_on: string; reason: string }>)}
        today={perthToday()}
        userId={userId}
      />
    </main>
  );
}
