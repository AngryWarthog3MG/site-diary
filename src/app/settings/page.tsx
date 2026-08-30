import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { SettingsForm, type SettingsData } from './settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Site Diary' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');

  const supabase = await createClient();

  const [{ data: row }, { data: state }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, code, principal_contractor, site_lat, site_lng, bom_station_id, active, org:organisations!inner(id, name, code)')
      .eq('id', current.project_id)
      .single(),
    supabase.rpc('project_settings_state', { p_project_id: current.project_id }),
  ]);

  if (!row) redirect('/');

  const org = (Array.isArray(row.org) ? row.org[0] : row.org) as {
    id: string;
    name: string;
    code: string;
  };
  const flags = (state ?? {}) as {
    can_edit?: boolean;
    code_locked?: boolean;
    org_code_locked?: boolean;
    signed_entries?: number;
  };

  const initial: SettingsData = {
    orgId: org.id,
    orgName: org.name,
    orgCode: org.code,
    projectId: row.id,
    projectName: row.name,
    projectCode: row.code,
    principalContractor: row.principal_contractor,
    siteLat: row.site_lat,
    siteLng: row.site_lng,
    bomStationId: row.bom_station_id,
    active: row.active,
    canEdit: Boolean(flags.can_edit),
    codeLocked: Boolean(flags.code_locked),
    orgCodeLocked: Boolean(flags.org_code_locked),
    signedEntries: flags.signed_entries ?? 0,
  };

  return <SettingsForm initial={initial} />;
}
