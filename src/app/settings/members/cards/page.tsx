import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { ROLES, ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign-in cards · KBS Daily Diary' };

/**
 * Rollout day. One card per person with a QR code that signs them in — the
 * same single-use link a magic-link email would carry, minted here by the
 * admin instead of mailed, so twenty people can start in one toolbox meeting
 * without a mail provider's hourly limit deciding who gets in. The links
 * expire (about an hour), so print the pack when the crew is in front of you.
 * Admin only; nothing here is stored.
 */
export default async function SignInCardsPage({ searchParams }: { searchParams: Promise<{ project?: string; role?: string }> }) {
  const { memberships } = await requireUser();
  const { project, role } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'settings');
  if (current.role !== 'admin') redirect(`/settings/members?project=${current.project_id}`);
  const wanted = role && (ROLES as string[]).includes(role) ? (role as MemberRole) : null;

  const supabase = await createClient();
  let q = supabase.from('project_members').select('user_id, role').eq('project_id', current.project_id);
  if (wanted) q = q.eq('role', wanted);
  const { data: rows } = await q;
  const memberRows = (rows ?? []) as Array<{ user_id: string; role: MemberRole }>;
  const { data: profiles } = memberRows.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', memberRows.map((r) => r.user_id))
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const byId = new Map((profiles ?? []).map((p) => [String(p.id), p as { full_name: string | null; email: string | null }]));
  const members = memberRows
    .map((r) => ({ userId: r.user_id, role: r.role, name: byId.get(r.user_id)?.full_name ?? null, email: byId.get(r.user_id)?.email ?? null }))
    .filter((m) => m.email)
    .sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''));

  const admin = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me';
  const cards = await Promise.all(members.map(async (m) => {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: m.email as string });
    const token = data?.properties?.hashed_token;
    if (error || !token) return { ...m, svg: null as string | null, error: error?.message ?? 'no link' };
    const link = `${site}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=magiclink&next=%2F`;
    const svg = await QRCode.toString(link, { type: 'svg', margin: 1, width: 220 });
    return { ...m, svg, error: null as string | null };
  }));
  const printed = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

  return (
    <main className="sheet sheet--wide cards">
      <div className="cards__head">
        <div>
          <p className="label"><BrandMark size={18} /> {current.project.name}</p>
          <h1 className="page-title">Sign-in cards{wanted ? ` — ${ROLE_LABEL[wanted]}s` : ''}</h1>
          <p className="page-subtitle">
            One card each. Scan it with the phone camera and the app opens signed in. Each code works once and
            expires in about an hour, so hand them out now. Printed {printed}.
          </p>
        </div>
        <div className="cards__tools">
          <a className="button button--quiet" href={`/settings/members?project=${current.project_id}`}>Back to members</a>
        </div>
      </div>
      {cards.length === 0 ? <p className="nil">Nobody{wanted ? ` with the role ${ROLE_LABEL[wanted]}` : ''} on this job yet.</p> : (
        <div className="cards__grid">
          {cards.map((c) => (
            <section key={c.userId} className="card">
              <p className="card__org label">{current.project.org.name} · {current.project.name}</p>
              <p className="card__name">{c.name ?? c.email}</p>
              <p className="card__role caption">{ROLE_LABEL[c.role]}{c.name ? ` · ${c.email}` : ''}</p>
              {c.svg ? <div className="card__qr" dangerouslySetInnerHTML={{ __html: c.svg }} /> : <p className="alert">{c.error}</p>}
              <p className="caption card__hint">Scan with the camera · one use · about an hour</p>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
