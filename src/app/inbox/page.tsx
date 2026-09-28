import { Suspense } from 'react';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { ReminderToggle } from '@/components/reminder-toggle';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { orderMessages, type MessageRow } from '@/lib/messages/model';
import { Inbox } from './inbox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages for you · Kooboolong IMS' };

/**
 * What the office has sent this person (README R112). Opening the page marks a message read; "Got it" records that
 * they understood. Every role has this door, the labourer included.
 */
export default async function InboxPage() {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('messages')
    .select('id, body, sent_at, push_result, push_devices, read_at, acknowledged_at, sender:profiles!messages_sender_profile_fk(full_name), project:projects(code, name)')
    .eq('recipient_id', userId);
  if (error) throw new Error(error.message);
  type Row = MessageRow & { sender: { full_name: string | null } | { full_name: string | null }[] | null; project: { code: string; name: string } | { code: string; name: string }[] | null };
  const rows = orderMessages((data ?? []) as unknown as Row[]).map((r) => {
    const sender = Array.isArray(r.sender) ? r.sender[0] : r.sender;
    const project = Array.isArray(r.project) ? r.project[0] : r.project;
    return { id: r.id, body: r.body, sent_at: r.sent_at, read_at: r.read_at, acknowledged_at: r.acknowledged_at, from: sender?.full_name ?? 'The office', job: project ? `${project.code} ${project.name}` : null };
  });
  return (
    <main className="sheet">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> Kooboolong IMS</p>
      <h1 className="page-title">Messages for you</h1>
      <p className="page-subtitle">What the office has sent you. Tap Got it when you have read one, so they know.</p>
      <ReminderToggle what="messages" />
      <Inbox rows={rows} />
    </main>
  );
}
