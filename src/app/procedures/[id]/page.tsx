import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, resolveProject, canRunTalks, guardScreen } from '@/lib/auth';
import { canAuthorEntries, ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { type ControlledKind } from '@/lib/documents-control/model';
import type { AssignmentRow } from '@/lib/documents-control/load';
import { ProcedureScreen, type ProcedureView, type Person } from './procedure-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document · Kooboolong IMS' };

export default async function ProcedurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { id } = await params;
  const { userId, memberships, profile } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'procedures');
  const supabase = await createClient();
  const canManage = canAuthorEntries(current.role);
  const [{ data: d }, { data: crew }] = await Promise.all([
    supabase.from('controlled_documents')
      .select('*, document_versions(id, version, file_path, summary, change_summary, status, issued_at, superseded_at, document_questions(id, position, prompt, options), document_acknowledgements(id, person_name, signature_path, acknowledged_on_device_at, project_id, recorded_by), document_assignments(id, version_id, user_id, status, due_on, signed_at, acknowledgement_id, last_reminded_at, reminder_count, waive_reason))')
      .eq('id', id).maybeSingle(),
    canRunTalks(current.role) ? supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name') : Promise.resolve({ data: [] as Array<{ name: string }> }),
  ]);
  if (!d) notFound();
  type V = ProcedureView['versions'][number] & { document_assignments: AssignmentRow[] | null; document_questions: ProcedureView['versions'][number]['questions'] | null };
  const raw = ((d.document_versions ?? []) as unknown as V[]).slice().sort((a, b) => b.version - a.version);
  const currentVersion = raw.find((v) => v.status === 'current') ?? null;

  // My own standing on the current version: the assignment, and whether I have passed its check.
  let passedAttempt: string | null = null;
  if (currentVersion && (currentVersion.document_questions ?? []).length > 0) {
    const { data: att } = await supabase.from('document_quiz_attempts').select('id').eq('version_id', currentVersion.id).eq('user_id', userId).eq('passed', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    passedAttempt = (att?.id as string | undefined) ?? null;
  }

  // Names for the assignment table: managers only, through the service role, for people on the company's jobs.
  const people = new Map<string, Person>();
  if (canManage) {
    const ids = [...new Set(raw.flatMap((v) => (v.document_assignments ?? []).map((a) => a.user_id)))];
    if (ids.length > 0) {
      const admin = createAdminClient();
      const [{ data: profiles }, { data: members }] = await Promise.all([
        admin.from('profiles').select('id, full_name, email').in('id', ids),
        admin.from('project_members').select('user_id, role, project:projects!inner(code, org_id)').in('user_id', ids).eq('project.org_id', current.project.org.id),
      ]);
      for (const p of profiles ?? []) people.set(p.id as string, { id: p.id as string, name: (p.full_name as string | null) ?? (p.email as string | null) ?? 'Unnamed', roles: [], jobs: [] });
      for (const m of members ?? []) {
        const pr = people.get(m.user_id as string); if (!pr) continue;
        const job = (Array.isArray(m.project) ? m.project[0] : m.project) as { code: string };
        const role = ROLE_LABEL[m.role as MemberRole] ?? String(m.role);
        if (!pr.roles.includes(role)) pr.roles.push(role);
        if (job?.code && !pr.jobs.includes(job.code)) pr.jobs.push(job.code);
      }
    }
  }

  const view: ProcedureView = {
    id: d.id, orgId: d.org_id, title: d.title, kind: d.kind as ControlledKind, doc_number: d.doc_number, requires_acknowledgement: d.requires_acknowledgement, active: d.active,
    audience: (d.audience as string[] | null) ?? [], ack_due_days: d.ack_due_days as number, review_interval_months: (d.review_interval_months as number | null) ?? null, pass_mark: (d.pass_mark as number | null) ?? null,
    versions: raw.map((v) => ({
      id: v.id, version: v.version, file_path: v.file_path, summary: v.summary, change_summary: v.change_summary ?? null, status: v.status, issued_at: v.issued_at, superseded_at: v.superseded_at,
      questions: (v.document_questions ?? []).slice().sort((a, b) => a.position - b.position),
      document_acknowledgements: (v.document_acknowledgements ?? []).slice().sort((a, b) => a.acknowledged_on_device_at.localeCompare(b.acknowledged_on_device_at)),
      assignments: (v.document_assignments ?? []).slice().sort((a, b) => a.due_on.localeCompare(b.due_on)),
    })),
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <OutboxStatus />
      <ProcedureScreen
        doc={view} projectId={current.project_id} crew={(crew ?? []).map((c) => String(c.name))}
        canManage={canManage} canSign={canRunTalks(current.role)} userId={userId} myName={profile?.full_name ?? null}
        passedAttempt={passedAttempt} people={[...people.values()]} today={perthToday()}
      />
    </main>
  );
}
