import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { perthToday } from '@/lib/push/decide';
import { peopleOnJob, type Induction } from '@/lib/crew/inductions';
import { MembersForm, AccessHistory, type AccessEvent, type MemberRow } from './members-form';
import { InductionsBlock } from './inductions-block';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Members · Kooboolong IMS' };

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  guardScreen(current, 'settings');
  if (!current) redirect('/');

  const canEdit = current.role === 'admin';
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from('project_members')
    .select('user_id, role, screens, finance, created_at')
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
      screens: (member.screens as string[] | null) ?? null,
      finance: (member.finance as boolean | null) ?? null,
      name: (profile?.full_name as string | null) ?? null,
      email: (profile?.email as string | null) ?? null,
      isCurrentUser: member.user_id === userId,
    };
  });

  // Who changed whose access, newest first — admins only, by the table's own policy (README R105).
  const { data: accessEvents } = canEdit
    ? await supabase.from('member_access_events').select('id, user_id, kind, old_role, new_role, money_before, money_after, old_screens, new_screens, changed_by, changed_at')
        .eq('project_id', current.project_id).order('changed_at', { ascending: false }).limit(25)
    : { data: [] };
  const eventPeople = [...new Set(((accessEvents ?? []) as Array<{ user_id: string; changed_by: string | null }>).flatMap((e) => [e.user_id, e.changed_by]).filter((x): x is string => Boolean(x)))];
  const { data: eventNames } = eventPeople.length ? await supabase.from('profiles').select('id, full_name, email').in('id', eventPeople) : { data: [] };
  const nameOf = (id: string | null) => { const p = (eventNames ?? []).find((x) => x.id === id); return (p?.full_name as string | null) ?? (p?.email as string | null) ?? (id ? 'someone' : 'the system'); };
  const history: AccessEvent[] = ((accessEvents ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: String(e.id), who: nameOf(e.user_id as string), by: nameOf((e.changed_by as string | null) ?? null), at: String(e.changed_at), kind: e.kind as AccessEvent['kind'],
    oldRole: (e.old_role as string | null) ?? null, newRole: (e.new_role as string | null) ?? null,
    moneyBefore: Boolean(e.money_before), moneyAfter: Boolean(e.money_after),
    screensChanged: JSON.stringify(e.old_screens ?? null) !== JSON.stringify(e.new_screens ?? null),
  }));

  const projectRef = `${current.project.org.code}_${current.project.code}`;

  // Inductions are by name: the roster and the members together (README R88).
  const [{ data: crew }, { data: inductionRows }] = await Promise.all([
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true),
    supabase.from('crew_inductions').select('person_name, inducted_on, notes, inducted_by').eq('project_id', current.project_id).order('inducted_on', { ascending: false }),
  ]);
  const recorderIds = [...new Set((inductionRows ?? []).map((r) => r.inducted_by as string | null).filter((id): id is string => Boolean(id) && !profileById.has(id!)))];
  const { data: recorders } = recorderIds.length ? await supabase.from('profiles').select('id, full_name').in('id', recorderIds) : { data: [] };
  const recorderName = (id: string | null) => {
    if (!id) return null;
    const p = profileById.get(id) ?? (recorders ?? []).find((r) => r.id === id);
    return (p?.full_name as string | null) ?? null;
  };
  const inductions: Induction[] = (inductionRows ?? []).map((r) => ({
    person_name: String(r.person_name),
    inducted_on: String(r.inducted_on),
    notes: (r.notes as string | null) ?? null,
    recorded_by: recorderName(r.inducted_by as string | null),
  }));
  const people = peopleOnJob(rows.map((r) => r.name), (crew ?? []).map((c) => String(c.name)));

  return (
    <main className="app-shell app-shell--narrow">
      <section className="sheet">
        <header className="page-header">
          <div>
            <p className="label">{current.project.name}</p>
            <h1 className="page-title">Members</h1>
            <p className="page-subtitle">
              Who is on this job. Add someone with their email and a title; they sign in with that email. The title
              says what they can do; the tick boxes under Access say which screens they see.
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
      {canEdit && <AccessHistory events={history} />}

      <hr className="rule" />

      <InductionsBlock
        projectId={current.project_id}
        userId={userId}
        people={people}
        inductions={inductions}
        canRecord={canRunTalks(current.role)}
        today={perthToday()}
      />

      <hr className="rule" />
      <Link className="button button--quiet" href={`/settings?project=${current.project_id}`}>
        Back to settings
      </Link>
      </section>
    </main>
  );
}
