import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { TalkScreen } from './talk-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Toolbox talk · KBS Daily Diary' };

export default async function TalkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { memberships } = await requireUser();
  const supabase = await createClient();

  const { data: talk } = await supabase
    .from('toolbox_talks')
    .select('id, project_id, talk_date, topic, summary, presenter_name, completed_at, toolbox_attendees(id, attendee_name, signature_path)')
    .eq('id', id)
    .maybeSingle();
  if (!talk) notFound();

  const membership = memberships.find((m) => m.project_id === talk.project_id);
  const canRun = membership ? membership.role === 'supervisor' || membership.role === 'admin' : false;

  return (
    <TalkScreen
      talk={{
        id: talk.id,
        projectId: talk.project_id,
        date: talk.talk_date,
        topic: talk.topic,
        summary: talk.summary,
        presenter: talk.presenter_name,
        completed: Boolean(talk.completed_at),
      }}
      attendees={(talk.toolbox_attendees as Array<{ id: string; attendee_name: string; signature_path: string }>) ?? []}
      canRun={canRun}
      projectName={membership?.project.name ?? 'Project'}
    />
  );
}
