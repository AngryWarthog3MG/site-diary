import 'server-only';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { MemberRole, Profile } from '@/types/database';

export interface Membership {
  project_id: string;
  role: MemberRole;
  project: {
    id: string;
    name: string;
    code: string;
    active: boolean;
    next_entry_seq: number;
    org: { id: string; name: string; code: string };
  };
}

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: Profile | null;
  memberships: Membership[];
}

/**
 * Loads the caller and their project memberships, or sends them to /login.
 * Every server component behind the middleware should start here.
 */
export async function requireUser(): Promise<SessionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [{ data: profile }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('project_members')
      .select(
        'project_id, role, project:projects!inner(id, name, code, active, next_entry_seq, org:organisations!inner(id, name, code))',
      )
      .eq('user_id', user.id)
      .order('project_id'),
  ]);

  // A failed lookup must never masquerade as "you have no projects" — that
  // message tells a seated supervisor they have been removed, over a blip.
  if (membershipError) {
    throw new Error(`Could not load your projects: ${membershipError.message}`);
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: (profile as Profile | null) ?? null,
    memberships: (memberships ?? []) as unknown as Membership[],
  };
}

/**
 * The reference this project's next signed entry will take: {ORG}-{DATE}.
 * The date must be the DEVICE's local day — a Perth knock-off is already
 * tomorrow in UTC — so client components pass localDate() and server
 * components pass nothing and get only the prefix behaviour they can justify.
 */
export function provisionalEntryNo(membership: Membership, localDate: string): string {
  return `${membership.project.org.code}-${localDate}`;
}

/** Supervisors and admins write the record; PMs read it. */
export function canAuthorEntries(role: MemberRole): boolean {
  return role === 'supervisor' || role === 'admin';
}

/**
 * Resolves the project the caller is acting in, enforcing membership.
 * Returns null when they belong to no project at all — a real state for a
 * newly invited user who has not been seated yet.
 */
export function resolveProject(
  memberships: Membership[],
  projectId?: string,
): Membership | null {
  const active = memberships.filter((m) => m.project.active);
  if (projectId) {
    return active.find((m) => m.project_id === projectId) ?? null;
  }
  return active[0] ?? null;
}
