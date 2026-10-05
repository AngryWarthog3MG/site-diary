import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadStaff } from '@/lib/staff/load';
import { buildStaff, summarise } from '@/lib/staff/model';
import { StaffScreen } from './staff-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'All staff · Kooboolong IMS' };

/**
 * Everyone who works for the company, in one place (README R123): role, tickets, inductions, and which jobs they are
 * on. Putting someone on a job here puts them on that job's crew list — what the diary, the prestart and the gate
 * offer. Nothing on the page is a copy: each line is the staff list, the crew lists, the tickets and the inductions
 * themselves, so a change here is the change everywhere. Admin.
 */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'staff');
  const org = current.project.org;
  const jobs = memberships
    .filter((m) => m.project.org.id === org.id && m.project.active)
    .map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name, canAssign: canRunTalks(m.role) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const supabase = await createClient();
  const today = perthToday();
  const input = await loadStaff(supabase, org.id, jobs);
  const people = buildStaff(input, today);
  const sum = summarise(people);
  const crewCounts: Record<string, number> = {};
  for (const c of input.crew) crewCounts[c.project_id] = (crewCounts[c.project_id] ?? 0) + 1;
  const roles = [...new Set([...input.staff.map((s) => s.role), ...input.crew.map((c) => c.role)].map((r) => (r ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const q = `?project=${current.project_id}`;

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">All staff</h1>
      <p className="page-subtitle">
        Everyone who works for {org.name}: their role, tickets and certificates, where they are inducted, and which jobs
        they are on. Tick a job and they are on that job’s crew list — the names the daily diary, the prestart and the
        gate offer.
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
      />
      <p className="caption" style={{ marginTop: '1.25rem' }}>
        The same tickets, set out person against competency: <Link href={`/training${q}&scope=company`}>Training matrix</Link>.
      </p>
    </main>
  );
}
