import { cookies } from 'next/headers';
import { fail, ok, requireApiUser } from '@/lib/api';
import { resolveProject, canAuthorEntries, canRunTalks, type Membership } from '@/lib/auth';
import { JOB_COOKIE, preferJob, readJobCookie } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

/**
 * Who is signed in and which job they are looking at — what the menu needs
 * to draw the right links. `?project=` picks the job the same way every
 * screen does; without it, the same default the screens fall back to.
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const { data: memberships, error } = await supabase
    .from('project_members')
    .select(
      'project_id, role, screens, project:projects!inner(id, name, code, active, next_entry_seq, org:organisations!inner(id, name, code))',
    )
    .eq('user_id', user.id)
    .order('project_id');
  if (error) return fail('server_error', `Could not load your projects: ${error.message}`, 500);

  // The job last chosen comes first, exactly as requireUser orders it for the pages (README R87).
  const jar = await cookies();
  const rows = preferJob((memberships ?? []) as unknown as Membership[], readJobCookie(jar.get(JOB_COOKIE)?.value));
  const current = resolveProject(rows, searchParams.get('project') ?? undefined);
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  return ok(
    {
      name: (profile?.full_name as string | null) ?? user.email ?? null,
      project: current
        ? { id: current.project_id, name: current.project.name, code: current.project.code, org: { name: current.project.org.name, code: current.project.org.code } }
        : null,
      role: current?.role ?? null,
      screens: current?.screens ?? null,
      canRecord: current ? canAuthorEntries(current.role) : false,
      canRunTalks: current ? canRunTalks(current.role) : false,
      projects: rows
        .filter((m) => m.project.active)
        .map((m) => ({ id: m.project_id, name: m.project.name, code: m.project.code, org: { name: m.project.org.name, code: m.project.org.code } })),
    },
    200,
  );
}
