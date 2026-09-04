import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { readChecklist } from '@/lib/prestart/checklist';
import { PrestartScreen } from './prestart-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Prestart · KBS Daily Diary' };

export default async function PrestartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { memberships } = await requireUser();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('prestarts')
    .select(
      `id, project_id, prestart_date, supervisor_name, work_planned, hazards, plant, permits, notes,
       checklist, completed_at,
       prestart_attendees(id, attendee_name, fit_for_work, signature_path, created_at)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!row) notFound();

  const membership = memberships.find((m) => m.project_id === row.project_id);
  const canRun = membership ? membership.role === 'supervisor' || membership.role === 'admin' : false;

  // The people this job already knows, most recent first, so sign-on is a
  // tap on a name rather than typing it with a glove on.
  const { data: roster } = await supabase
    .from('crew')
    .select('name')
    .eq('project_id', row.project_id)
    .eq('active', true)
    .order('sort_order')
    .order('name');
  const { data: recent } = await supabase
    .from('labour')
    .select('person_name, entry:entries!inner(project_id, entry_date)')
    .eq('entry.project_id', row.project_id)
    .order('entry_date', { referencedTable: 'entry', ascending: false })
    .limit(300);
  const crew: string[] = [];
  for (const r of roster ?? []) {
    const name = String(r.name ?? '').trim();
    if (name && !crew.includes(name)) crew.push(name);
  }
  for (const r of recent ?? []) {
    const name = String(r.person_name ?? '').trim();
    if (name && !crew.includes(name)) crew.push(name);
  }

  const attendees = ((row.prestart_attendees ?? []) as Array<{
    id: string; attendee_name: string; fit_for_work: boolean; signature_path: string; created_at: string;
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
        checklist: readChecklist(row.checklist),
        completed: Boolean(row.completed_at),
      }}
      attendees={attendees}
      crew={crew.slice(0, 24)}
      canRun={canRun}
      projectName={membership?.project.name ?? 'Project'}
    />
  );
}
