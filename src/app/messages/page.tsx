import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { orderMessages, type MessageRow } from '@/lib/messages/model';
import { SendMessage, type Person, type SentRow } from './send-message';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Send a message · Kooboolong IMS' };

/**
 * The office's messages (README R112): pick someone on any of the company's jobs, say what they need to do, and it
 * goes to their phone and stays on the record — sent, delivered, opened, got it. Admins only.
 */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'messages');
  const orgId = current.project.org.id;
  const supabase = await createClient();

  // Everyone on the company's jobs, once each, with their jobs and whether a phone is registered.
  const { data: members } = await supabase.from('project_members').select('user_id, role, project:projects!inner(id, code, org_id, active)').eq('project.org_id', orgId);
  type M = { user_id: string; role: string; project: { id: string; code: string; active: boolean } | { id: string; code: string; active: boolean }[] };
  const byUser = new Map<string, { roles: Set<string>; jobs: Set<string> }>();
  for (const m of (members ?? []) as unknown as M[]) {
    const p = Array.isArray(m.project) ? m.project[0] : m.project;
    if (!p.active || m.user_id === userId) continue;
    const e = byUser.get(m.user_id) ?? { roles: new Set(), jobs: new Set() };
    e.roles.add(m.role); e.jobs.add(p.code); byUser.set(m.user_id, e);
  }
  const ids = [...byUser.keys()];
  const admin = createAdminClient();
  const [{ data: profiles }, { data: subs }] = await Promise.all([
    ids.length ? supabase.from('profiles').select('id, full_name, email').in('id', ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from('push_subscriptions').select('user_id').in('user_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const devices = new Map<string, number>();
  for (const s of (subs ?? []) as Array<{ user_id: string }>) devices.set(s.user_id, (devices.get(s.user_id) ?? 0) + 1);
  const people: Person[] = ids.map((id) => {
    const p = (profiles ?? []).find((x) => x.id === id);
    const e = byUser.get(id)!;
    return { id, name: (p?.full_name as string | null) ?? (p?.email as string | null) ?? 'Unnamed', roles: [...e.roles].map((r) => ROLE_LABEL[r as MemberRole] ?? r), jobs: [...e.jobs].sort(), devices: devices.get(id) ?? 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const { data: sent, error: sentError } = await supabase
    .from('messages')
    .select('id, body, sent_at, push_result, push_devices, read_at, acknowledged_at, recipient_id, sender:profiles!messages_sender_profile_fk(full_name), recipient:profiles!messages_recipient_profile_fk(full_name, email), project:projects(code)')
    .eq('org_id', orgId);
  if (sentError) throw new Error(sentError.message);
  type P = { full_name: string | null; email?: string | null };
  type S = MessageRow & { recipient_id: string; sender: P | P[] | null; recipient: P | P[] | null; project: { code: string } | { code: string }[] | null };
  const rows: SentRow[] = orderMessages((sent ?? []) as unknown as S[]).slice(0, 200).map((s) => {
    const sender = Array.isArray(s.sender) ? s.sender[0] : s.sender;
    const recipient = Array.isArray(s.recipient) ? s.recipient[0] : s.recipient;
    const proj = Array.isArray(s.project) ? s.project[0] : s.project;
    return { id: s.id, body: s.body, sent_at: s.sent_at, push_result: s.push_result, push_devices: s.push_devices, read_at: s.read_at, acknowledged_at: s.acknowledged_at, to: recipient?.full_name ?? recipient?.email ?? 'Someone', from: sender?.full_name ?? '—', job: proj?.code ?? null };
  });
  const jobs = memberships.filter((m) => m.project.active && m.project.org.id === orgId).map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name }));

  return (
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Send a message</h1>
      <p className="page-subtitle">
        Tell someone something — take photos, sign the SWMS, ring the office. It goes to their phone as a notification and
        sits in their app under Messages for you, and every message stays on the record: sent, delivered, opened, got it.
      </p>
      <SendMessage orgId={orgId} people={people} jobs={jobs} defaultJob={current.project_id} sent={rows} />
    </main>
  );
}
