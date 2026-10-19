import { canRunTalks } from '@/lib/roles';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, guardScreen } from '@/lib/auth';
import { readChecklist } from '@/lib/prestart/checklist';
import { readSpecNotes } from '@/lib/prestart/spec-notes';
import { PrestartScreen } from './prestart-screen';
import { loadPlantOnJob } from '@/lib/plant/on-job';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Prestart · Kooboolong IMS' };

export default async function PrestartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { memberships } = await requireUser();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('prestarts')
    .select(
      `id, project_id, prestart_date, supervisor_name, work_planned, hazards, plant, permits, notes, dictation, spec_notes,
       checklist, completed_at,
       prestart_attendees(id, attendee_name, fit_for_work, signature_path, inducted, created_at)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!row) notFound();

  const membership = memberships.find((m) => m.project_id === row.project_id);
  guardScreen(membership, 'prestart');
  const canRun = membership ? canRunTalks(membership.role) : false;

  // The job's crew, in roster order, so sign-on is a tap on a name rather than typing it
  // with a glove on. Only the roster: names harvested from old labour rows brought every
  // nickname and misspelling back as a chip (README R156, R128).
  const { data: roster } = await supabase
    .from('crew')
    .select('name')
    .eq('project_id', row.project_id)
    .eq('active', true)
    .order('sort_order')
    .order('name');
  const { data: inductionRows } = await supabase.from('crew_inductions').select('person_name').eq('project_id', row.project_id);
  // The job's machines and their check for THIS day (README R151): the plant prestart is part of the morning, daily.
  const [onJob, { data: checks }] = await Promise.all([
    loadPlantOnJob(supabase, row.project_id),
    supabase.from('plant_prestarts').select('plant_id, operator_name, fit_for_use, completed_at').eq('project_id', row.project_id).eq('prestart_date', row.prestart_date).not('completed_at', 'is', null).order('completed_at', { ascending: false }),
  ]);
  const checkOf = new Map<string, { fit: boolean; operator: string }>();
  for (const c of (checks ?? []) as Array<{ plant_id: string; operator_name: string; fit_for_use: boolean }>) if (!checkOf.has(c.plant_id)) checkOf.set(c.plant_id, { fit: Boolean(c.fit_for_use), operator: c.operator_name });
  const machines = onJob.map((m) => ({ id: m.id, name: m.name, kind: m.kind, plantNo: m.plant_no, check: checkOf.get(m.id) ?? null }));
  const inducted = (inductionRows ?? []).map((r) => String(r.person_name));
  const crew: string[] = [];
  for (const r of roster ?? []) {
    const name = String(r.name ?? '').trim();
    if (name && !crew.includes(name)) crew.push(name);
  }

  const attendees = ((row.prestart_attendees ?? []) as Array<{
    id: string; attendee_name: string; fit_for_work: boolean; signature_path: string; inducted: boolean | null; created_at: string;
  }>).sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <PrestartScreen
      prestart={{
        id: row.id,
        projectId: row.project_id,
        date: row.prestart_date,
        supervisor: row.supervisor_name,
        work: row.work_planned,
        hazards: row.hazards,
        plant: row.plant ?? '',
        permits: row.permits ?? '',
        notes: row.notes ?? '',
        dictation: (row.dictation as string | null) ?? null,
        checklist: readChecklist(row.checklist),
        specNotes: readSpecNotes(row.spec_notes),
        completed: Boolean(row.completed_at),
      }}
      attendees={attendees}
      crew={crew.slice(0, 24)}
      inducted={inducted}
      machines={machines}
      canRun={canRun}
      projectName={membership?.project.name ?? 'Project'}
    />
  );
}
