import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { SettingsForm, type SettingsData } from './settings-form';
import { CrewList, type CrewRow } from './crew-list';
import Link from 'next/link';
import { CrewTickets, type TicketRow, type InductionRow } from './crew-tickets';
import { perthToday } from '@/lib/push/decide';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Kooboolong IMS' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!sees(current, 'settings')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();

  const [{ data: row }, { data: state }, { data: crew }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, code, principal_contractor, site_lat, site_lng, bom_station_id, active, report_emails, day_closer_id, org:organisations!inner(id, name, code)')
      .eq('id', current.project_id)
      .single(),
    supabase.rpc('project_settings_state', { p_project_id: current.project_id }),
    supabase
      .from('crew')
      .select('id, name, role, active')
      .eq('project_id', current.project_id)
      .order('sort_order')
      .order('name'),
  ]);

  if (!row) redirect('/');
  // Who may be named to close the day (README R126): the job's members with an authoring role, by name.
  const { data: memberRows } = await supabase.from('project_members').select('user_id, role').eq('project_id', current.project_id);
  const closerIds = ((memberRows ?? []) as Array<{ user_id: string; role: string }>).filter((m) => canAuthorEntries(m.role as MemberRole)).map((m) => m.user_id);
  const { data: closerProfiles } = closerIds.length ? await supabase.from('profiles').select('id, full_name, email').in('id', closerIds) : { data: [] };
  const closerOptions = ((closerProfiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)
    .map((p) => ({ id: p.id, name: (p.full_name ?? p.email ?? 'Unnamed') as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const orgIdForTickets = ((Array.isArray(row.org) ? row.org[0] : row.org) as { id: string }).id;
  const [{ data: tickets }, { data: inductions }] = await Promise.all([
    supabase.from('crew_tickets').select('id, person_name, ticket_type, ticket_no, issued_on, expires_on, photo_path, active').eq('org_id', orgIdForTickets).eq('active', true).order('expires_on'),
    supabase.from('crew_inductions').select('person_name, inducted_on').eq('project_id', current.project_id),
  ]);

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
    reportEmails: ((row.report_emails as string[] | null) ?? []).join(', '),
    dayCloserId: (row.day_closer_id as string | null) ?? null,
    closerOptions,
    canEdit: Boolean(flags.can_edit),
    codeLocked: Boolean(flags.code_locked),
    orgCodeLocked: Boolean(flags.org_code_locked),
    signedEntries: flags.signed_entries ?? 0,
  };

  return (
    <>
      <SettingsForm initial={initial} />
      <div className="app-shell app-shell--narrow" style={{ paddingTop: 0 }}>
        <section className="sheet">
          <CrewList
            projectId={current.project_id}
            initial={(crew ?? []) as CrewRow[]}
            canEdit={canAuthorEntries(current.role)}
          />
        </section>
        <section className="sheet" style={{ marginTop: '1rem' }}>
          <CrewTickets
            orgId={org.id}
            projectId={current.project_id}
            people={((crew ?? []) as CrewRow[]).filter((c) => c.active).map((c) => c.name)}
            tickets={(tickets ?? []) as TicketRow[]}
            inductions={(inductions ?? []) as InductionRow[]}
            canEdit={canAuthorEntries(current.role)}
            today={perthToday()}
          />
        </section>
        <section className="sheet" style={{ marginTop: '1rem' }}>
          <p className="label">Your account</p>
          <h2 className="home-card__title">Two-factor sign-in</h2>
          <p className="caption">
            A six-digit code from an authenticator app, as well as the email link. Anyone who sees the company&rsquo;s
            money needs it; the money stays shut without it.
          </p>
          <Link className="button button--quiet" href="/security">Security</Link>
        </section>
        <section className="sheet" style={{ marginTop: '1rem' }}>
          <p className="label">Plant</p>
          <h2 className="home-card__title">One register, under Plant</h2>
          <p className="caption">
            The company&rsquo;s machines live in one place. Tick which are on this job there, and the
            diary, the review screen and the plant prestarts all read the same list.
          </p>
          <Link className="button button--quiet" href={`/plant?project=${current.project_id}`}>Open Plant</Link>
        </section>
      </div>
    </>
  );
}
