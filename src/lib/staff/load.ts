import type { SupabaseClient } from '@supabase/supabase-js';
import { ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { competencies } from '@/lib/training/model';
import type { CrewRef, InductionRef, JobRef, LoginRef, StaffInput, StaffRow, TicketRef } from './model';

/**
 * Everything the staff list shows, read under the caller's RLS (README R123): the list itself, and for the company's
 * jobs the caller is on — the crew lists, the inductions, the logins — plus the company's tickets and what each role
 * must hold. One gather; `buildStaff` joins it by name.
 */
/** What only the admin client knows about an account (README R148): last sign-in, and whether it is closed. */
export interface LoginFacts { lastSignIn: string | null; closed: boolean }

export async function loadStaff(supabase: SupabaseClient, orgId: string, jobs: readonly JobRef[], facts: ReadonlyMap<string, LoginFacts> = new Map()): Promise<StaffInput> {
  const ids = jobs.map((j) => j.id);
  const none = Promise.resolve({ data: [] as unknown[], error: null });
  const [staff, crew, tickets, inductions, reqs, custom, members] = await Promise.all([
    supabase.from('staff').select('id, name, role, phone, employer, notes, active, emergency_contact').eq('org_id', orgId).order('name'),
    ids.length ? supabase.from('crew').select('id, project_id, name, role, active').in('project_id', ids) : none,
    supabase.from('crew_tickets').select('id, person_name, ticket_type, ticket_no, issued_on, expires_on, photo_path, active').eq('org_id', orgId),
    ids.length ? supabase.from('crew_inductions').select('project_id, person_name, inducted_on, notes').in('project_id', ids) : none,
    supabase.from('competency_requirements').select('role, competency').eq('org_id', orgId),
    supabase.from('org_competencies').select('key, label, valid_months, active').eq('org_id', orgId).order('label'),
    ids.length ? supabase.from('project_members').select('user_id, role, project_id, finance, screens, manages_people').in('project_id', ids) : none,
  ]);
  for (const r of [staff, crew, tickets, inductions, reqs, custom, members]) if (r.error) throw new Error(`Could not read the staff list: ${r.error.message}`);

  const memberRows = (members.data ?? []) as Array<{ user_id: string; role: string; project_id: string; finance: boolean | null; screens: string[] | null; manages_people: boolean | null }>;
  const userIds = [...new Set(memberRows.map((m) => m.user_id))];
  const { data: profiles } = userIds.length ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds) : { data: [] };
  const profileOf = new Map((profiles ?? []).map((p) => [p.id as string, { name: (p.full_name as string | null) ?? '', email: (p.email as string | null) ?? null }]));
  const codeOf = new Map(jobs.map((j) => [j.id, j.code]));
  const logins: LoginRef[] = memberRows
    .map((m) => {
      const pr = profileOf.get(m.user_id);
      const f = facts.get(m.user_id);
      return {
        name: pr?.name ?? '', projectCode: codeOf.get(m.project_id) ?? '', role: ROLE_LABEL[m.role as MemberRole] ?? m.role,
        userId: m.user_id, projectId: m.project_id, email: pr?.email ?? null, roleKey: m.role, finance: m.finance ?? null, screens: m.screens ?? null,
        lastSignIn: f?.lastSignIn ?? null, closed: f?.closed ?? false, managesPeople: Boolean(m.manages_people),
      };
    })
    .filter((l) => l.name.trim() !== '' && l.projectCode !== '');

  return {
    staff: (staff.data ?? []) as StaffRow[],
    jobs,
    crew: (crew.data ?? []) as CrewRef[],
    tickets: (tickets.data ?? []) as TicketRef[],
    inductions: (inductions.data ?? []) as InductionRef[],
    competencies: competencies((custom.data ?? []) as Array<{ key: string; label: string; valid_months: number | null; active: boolean }>),
    requirements: (reqs.data ?? []) as Array<{ role: string; competency: string }>,
    logins,
  };
}
