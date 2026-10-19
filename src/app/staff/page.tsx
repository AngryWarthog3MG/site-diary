import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadStaff, type LoginFacts } from '@/lib/staff/load';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildStaff, summarise, loginsOffTheList } from '@/lib/staff/model';
import { StaffScreen } from './staff-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'People · Kooboolong IMS' };

/**
 * Everyone who works for the company, in one place (README R123): role, tickets, inductions, and which jobs they are
 * on. Putting someone on a job here puts them on that job's crew list — what the diary, the prestart and the gate
 * offer. Nothing on the page is a copy: each line is the staff list, the crew lists, the tickets and the inductions
 * themselves, so a change here is the change everywhere. Admin.
 */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ project?: string; job?: string }> }) {
  const { userId, memberships, aal } = await requireUser();
  const { project, job } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'staff');
  const org = current.project.org;
  const jobs = memberships
    .filter((m) => m.project.org.id === org.id && m.project.active)
    .map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name, canAssign: canRunTalks(m.role), isAdmin: m.role === 'admin', managesPeople: m.role === 'admin' || (m.role === 'pm' && Boolean(m.manages_people)) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const supabase = await createClient();
  const today = perthToday();
  // What only the admin client knows about an account (README R148): the last sign-in, and whether it is closed.
  // An office page already (pm/admin); the facts are read, never written, and only for people on this company's jobs.
  const facts = new Map<string, LoginFacts>();
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) {
      const banned = (u as { banned_until?: string | null }).banned_until ?? null;
      facts.set(u.id, { lastSignIn: u.last_sign_in_at ?? null, closed: Boolean(banned && new Date(banned) > new Date()) });
    }
  } catch { /* the page still draws; the login lines just say less */ }
  const input = await loadStaff(supabase, org.id, jobs, facts);
  const people = buildStaff(input, today);
  const sum = summarise(people);
  const crewCounts: Record<string, number> = {};
  for (const c of input.crew) crewCounts[c.project_id] = (crewCounts[c.project_id] ?? 0) + 1;
  const roles = [...new Set([...input.staff.map((s) => s.role), ...input.crew.map((c) => c.role)].map((r) => (r ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const q = `?project=${current.project_id}`;

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">People</h1>
      <p className="page-subtitle">
        Everyone who works for {org.name}, in one place: their login and title, the jobs they are on, where they are
        inducted, their tickets, and who to call. Tick a job and they are on it — the crew list the diary, the prestart and
        the gate offer, and their login too.
      </p>
      <div className="regs__facts docs__tiles">
        <span className="regs__fact"><span className="regs__fact-label">People</span><span className="regs__fact-text docs__big">{sum.people}</span><span className="regs__fact-sub">{sum.onAJob} on a job · {sum.noJob} on none</span></span>
        <span className={`regs__fact${sum.expired ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Tickets expired</span><span className="regs__fact-text docs__big">{sum.expired}</span><span className="regs__fact-sub">{sum.expiring} expiring within 30 days</span></span>
        <span className={`regs__fact${sum.notInducted ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Not inducted</span><span className="regs__fact-text docs__big">{sum.notInducted}</span><span className="regs__fact-sub">on a job with no induction recorded</span></span>
        <span className={`regs__fact${sum.gaps ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Missing for their role</span><span className="regs__fact-text docs__big">{sum.gaps}</span><span className="regs__fact-sub"><Link href={`/training/requirements${q}`}>What each role must hold</Link></span></span>
      </div>
      <StaffScreen
        orgId={org.id} orgName={org.name} projectId={current.project_id} userId={userId} today={today}
        people={people} jobs={jobs} crewCounts={crewCounts} roles={roles}
        competencies={input.competencies.filter((c) => !c.retired).map((c) => ({ key: c.key, label: c.label }))}
        codeEntered={aal.current === 'aal2'}
        initialJob={job && jobs.some((j) => j.id === job) ? job : 'all'}
        offList={loginsOffTheList(input)}
      />
      <p className="caption" style={{ marginTop: '1.25rem' }}>
        The same tickets, set out person against competency: <Link href={`/training${q}&scope=company`}>Training matrix</Link>.
      </p>
    </main>
  );
}
