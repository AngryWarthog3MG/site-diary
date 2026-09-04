import { fail, ok, requireApiUser } from '@/lib/api';
import { resolveProject, canAuthorEntries, type Membership } from '@/lib/auth';

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
      'project_id, role, project:projects!inner(id, name, code, active, next_entry_seq, org:organisations!inner(id, name, code))',
    )
    .eq('user_id', user.id)
    .order('project_id');
  if (error) return fail('server_error', `Could not load your projects: ${error.message}`, 500);

  const rows = (memberships ?? []) as unknown as Membership[];
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
        ? { id: current.project_id, name: current.project.name, code: current.project.code }
        : null,
      role: current?.role ?? null,
      canRecord: current ? canAuthorEntries(current.role) : false,
      projects: rows
        .filter((m) => m.project.active)
        .map((m) => ({ id: m.project_id, name: m.project.name, code: m.project.code })),
    },
    200,
  );
}
