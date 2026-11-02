import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { loadPlantOnJob } from '@/lib/plant/on-job';
import { peopleOnJob } from '@/lib/crew/inductions';
import { asTemplate, loadSubmission } from '@/lib/forms/load';
import { FormFill } from './form-fill';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fill a form · Kooboolong IMS' };

/**
 * Filling a form (README R180): `/forms/fill/new?template=` starts one on a phone-chosen id, `/forms/fill/[id]`
 * resumes an open one. The database decides who may fill which form (`app.can_fill_form`); this page only
 * refuses what it can already see is wrong.
 */
export default async function FillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string; template?: string; schedule?: string }> }) {
  const { id } = await params;
  const { project, template, schedule } = await searchParams;
  const { memberships, userId } = await requireUser();
  const supabase = await createClient();

  let current = resolveProject(memberships, project);
  const open = id === 'new' ? null : await loadSubmission(supabase, id);
  if (id !== 'new') {
    if (!open) notFound();
    current = memberships.find((m) => m.project_id === open.project_id) ?? null;
  }
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  guardScreen(current, 'forms');
  const q = `?project=${current.project_id}`;
  if (open && open.status !== 'open') redirect(`/forms/${open.id}${q}`);
  if (open && open.started_by !== userId) redirect(`/forms${q}`);

  let tpl = null as ReturnType<typeof asTemplate> | null;
  // Started from a schedule (README R181): the link is kept on the row and what the schedule is about is filled in.
  let sched: { id: string; subject_plant_id: string | null; subject_person: string | null } | null = null;
  if (!open) {
    if (!template) redirect(`/forms${q}`);
    const [{ data }, { data: sc }] = await Promise.all([
      supabase.from('form_templates').select('*').eq('id', template).eq('status', 'issued').maybeSingle(),
      schedule ? supabase.from('form_schedules').select('id, template_code, subject_plant_id, subject_person').eq('id', schedule).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!data) notFound();
    tpl = asTemplate(data as Record<string, unknown>);
    const scRow = sc as { id: string; template_code: string; subject_plant_id: string | null; subject_person: string | null } | null;
    if (scRow && scRow.template_code === tpl.code) sched = scRow;
  }
  const [machines, { data: crew }, { data: members }] = await Promise.all([
    loadPlantOnJob(supabase, current.project_id),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true),
    supabase.from('project_members').select('profile:profiles(full_name)').eq('project_id', current.project_id),
  ]);
  const memberNames = ((members ?? []) as Array<{ profile: { full_name: string | null } | Array<{ full_name: string | null }> | null }>).map((m) => (Array.isArray(m.profile) ? m.profile[0]?.full_name : m.profile?.full_name) ?? null);
  const people = peopleOnJob(memberNames, ((crew ?? []) as Array<{ name: string }>).map((c) => c.name));
  const submissionId = open?.id ?? crypto.randomUUID();
  const title = open?.template_title ?? tpl?.title ?? '';

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{title}</h1>
      <OutboxStatus />
      <FormFill
        submissionId={submissionId}
        projectId={current.project_id}
        userId={userId}
        templateId={open?.template_id ?? (tpl?.id as string)}
        code={open?.template_code ?? (tpl?.code as string)}
        title={title}
        revision={open?.revision ?? (tpl?.revision as string)}
        spec={open?.spec ?? (tpl?.spec as NonNullable<typeof tpl>['spec'])}
        passMark={open?.pass_mark ?? tpl?.pass_mark ?? null}
        signatureRule={open?.signature_rule ?? tpl?.signature ?? 'required'}
        subject={open?.subject ?? tpl?.subject ?? 'none'}
        basis={tpl?.basis ?? null}
        scheduleId={open?.schedule_id ?? sched?.id ?? null}
        initial={{ answers: open?.answers ?? {}, header: open?.header ?? {}, subjectPlantId: open?.subject_plant_id ?? sched?.subject_plant_id ?? null, subjectPerson: open?.subject_person ?? sched?.subject_person ?? null }}
        machines={machines.map((m) => ({ id: m.id, name: m.plant_no ? `${m.name} · ${m.plant_no}` : m.name }))}
        people={people}
        isNew={!open}
      />
    </main>
  );
}
