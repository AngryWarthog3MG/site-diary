import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { MembersForm, type MemberRow } from './members-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Members · Site Diary' };

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');

  const canEdit = current.role === 'admin';
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from('project_members')
    .select('user_id, role, created_at')
    .eq('project_id', current.project_id)
    .order('role')
    .order('created_at');

  if (error) {
    throw new Error(`Could not load members: ${error.message}`);
  }

  const ids = (members ?? []).map((member) => member.user_id as string);
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const rows: MemberRow[] = (members ?? []).map((member) => {
    const profile = profileById.get(member.user_id as string);
    return {
      userId: member.user_id as string,
      role: member.role as MemberRow['role'],
      name: (profile?.full_name as string | null) ?? null,
      email: (profile?.email as string | null) ?? null,
      isCurrentUser: member.user_id === userId,
    };
  });

  const projectRef = `${current.project.org.code}_${current.project.code}`;

  return (
    <main className="app-shell app-shell--narrow">
      <section className="sheet">
        <header className="page-header">
          <div>
            <p className="label">{current.project.name}</p>
            <h1 className="page-title">Members</h1>
            <p className="page-subtitle">
              Supervisors and admins can record. PMs read the signed record.
            </p>
          </div>
        </header>

      <hr className="rule" />

      <MembersForm
        projectId={current.project_id}
        projectRef={projectRef}
        canEdit={canEdit}
        members={rows}
      />

      <hr className="rule" />
      <Link className="button button--quiet" href={`/settings?project=${current.project_id}`}>
        Back to settings
      </Link>
      </section>
    </main>
  );
}
