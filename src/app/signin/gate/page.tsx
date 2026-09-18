import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { DEFAULT_RULES, gateUrl } from '@/lib/gate/model';
import { GateAdmin } from './gate-admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gate code · Kooboolong IMS' };

/** The gate code for this job: the QR to print, the rules a visitor accepts, and a new code when the old one is compromised. */
export default async function GatePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/signin?project=${current.project_id}`);
  const supabase = await createClient();
  const { data: gate } = await supabase.from('gate_tokens').select('id, token, rules, created_at').eq('project_id', current.project_id).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  let svg: string | null = null;
  if (gate) {
    const QRCode = await import('qrcode');
    svg = await QRCode.toString(gateUrl(gate.token as string, process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me'), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Gate code</h1>
      <p className="page-subtitle">A visitor scans the code on the gate sign and signs themselves in on their own phone — name, company, why they are here, a mobile, the site rules accepted, a signature. They land in the same register as your taps.</p>
      <GateAdmin
        projectId={current.project_id} userId={userId}
        gate={gate ? { id: gate.id as string, token: gate.token as string, rules: (gate.rules as string | null) ?? DEFAULT_RULES, since: gate.created_at as string, svg: svg ?? '' } : null}
        base={process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me'}
        defaultRules={DEFAULT_RULES}
      />
    </main>
  );
}
