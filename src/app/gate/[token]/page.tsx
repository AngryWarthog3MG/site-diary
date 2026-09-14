import { createAdminClient } from '@/lib/supabase/admin';
import { BrandMark } from '@/components/brand-mark';
import { DEFAULT_RULES } from '@/lib/gate/model';
import { GateForm } from './gate-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Site sign-in' };

/**
 * The gate, on the visitor's own phone. No account: the code on the sign is
 * the key, and it opens one thing — signing yourself in and out of this job.
 */
export default async function GatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: gate } = /^[a-z2-9]{16,40}$/.test(token)
    ? await admin.from('gate_tokens').select('id, rules, project:projects!inner(id, name, active, org:organisations!inner(name))').eq('token', token).eq('active', true).maybeSingle()
    : { data: null };
  const project = gate ? ((Array.isArray(gate.project) ? gate.project[0] : gate.project) as { id: string; name: string; active: boolean; org: { name: string } | { name: string }[] }) : null;
  if (!gate || !project || !project.active) {
    return (
      <main className="sheet">
        <p className="label"><BrandMark size={18} /> Site sign-in</p>
        <h1 className="page-title">This gate code is not in use</h1>
        <p className="page-subtitle">Ask at the site office to be signed in.</p>
      </main>
    );
  }
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">{project.name}</h1>
      <p className="page-subtitle">Sign in before you go past the gate, and sign out when you leave.</p>
      <GateForm token={token} projectName={project.name} rules={(gate.rules as string | null) ?? DEFAULT_RULES} />
    </main>
  );
}
