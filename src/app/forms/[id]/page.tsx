import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, guardScreen } from '@/lib/auth';
import { canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { loadSubmission, loadNonCompliances, namesFor } from '@/lib/forms/load';
import { SubmissionScreen } from './submission-screen';
import { toNcView } from '../nc-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Form · Kooboolong IMS' };

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { memberships, userId } = await requireUser();
  const supabase = await createClient();
  const s = await loadSubmission(supabase, id);
  if (!s) notFound();
  const membership = memberships.find((m) => m.project_id === s.project_id);
  if (!membership) notFound();
  guardScreen(membership, 'forms');
  const [ncs, { data: machine }] = await Promise.all([
    loadNonCompliances(supabase, { submissionId: s.id }, { includeClosed: true }),
    s.subject_plant_id ? supabase.from('plant_register').select('name, plant_no').eq('id', s.subject_plant_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nameOf = await namesFor(supabase, [s.started_by, s.completed_by, ...ncs.map((n) => n.resolved_by), ...ncs.map((n) => n.assigned_to)]);
  const isOffice = membership.role === 'pm' || membership.role === 'admin';
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {membership.project.name}</p>
      <OutboxStatus />
      <SubmissionScreen
        s={{
          id: s.id, projectId: s.project_id, code: s.template_code, title: s.template_title, revision: s.revision, spec: s.spec, answers: s.answers, header: s.header,
          status: s.status, score: s.score, outcome: s.outcome, passMark: s.pass_mark, subjectPerson: s.subject_person,
          machine: machine ? `${(machine as { name: string }).name}${(machine as { plant_no: string | null }).plant_no ? ` · ${(machine as { plant_no: string | null }).plant_no}` : ''}` : null,
          startedBy: nameOf.get(s.started_by) ?? 'someone', startedAt: s.started_at, completedBy: s.completed_by ? nameOf.get(s.completed_by) ?? null : null,
          completedAt: s.completed_at, completedOnDeviceAt: s.completed_on_device_at, signaturePath: s.signature_path, voidedAt: s.voided_at, voidReason: s.void_reason,
        }}
        ncs={ncs.map((n) => toNcView(n, nameOf))}
        canAct={canRunTalks(membership.role)}
        isOffice={isOffice}
        today={perthToday()}
        userId={userId}
      />
    </main>
  );
}
