import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import type { CostKind, RateItem } from '@/lib/variations/costs';
import { RatesScreen } from './rates-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rates · Kooboolong IMS' };

/**
 * The rate card (README R104): what we charge for labour by role, for each machine, and for materials — the
 * company's rates, and this job's own where its head contract's schedule differs. Variation build-ups price from
 * here. The office sets rates; the people who price variations read them.
 */
export default async function RatesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'rates');

  const supabase = await createClient();
  const orgId = current.project.org.id;
  const [{ data: rates }, { data: plant }, { data: changes }] = await Promise.all([
    supabase.from('rate_items').select('id, org_id, project_id, kind, label, plant_id, unit, rate, notes, active')
      .eq('org_id', orgId).or(`project_id.is.null,project_id.eq.${current.project_id}`),
    supabase.from('plant_register').select('id, name, plant_no, active').eq('org_id', orgId).order('name'),
    supabase.from('rate_item_changes').select('rate_item_id, old_rate, new_rate, changed_at').eq('org_id', orgId).order('changed_at', { ascending: false }).limit(200),
  ]);
  const items: RateItem[] = ((rates ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), org_id: String(r.org_id), project_id: (r.project_id as string | null) ?? null, kind: r.kind as CostKind,
    label: String(r.label), plant_id: (r.plant_id as string | null) ?? null, unit: String(r.unit), rate: Number(r.rate),
    notes: (r.notes as string | null) ?? null, active: Boolean(r.active),
  }));
  const lastChange: Record<string, { from: number | null; at: string }> = {};
  for (const c of (changes ?? []) as Array<{ rate_item_id: string; old_rate: unknown; new_rate: unknown; changed_at: string }>) {
    if (lastChange[c.rate_item_id] || c.old_rate == null || Number(c.old_rate) === Number(c.new_rate)) continue;
    lastChange[c.rate_item_id] = { from: Number(c.old_rate), at: c.changed_at };
  }
  const office = current.role === 'pm' || current.role === 'admin';

  return (
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.org.name} · {current.project.name}</p>
      <h1 className="page-title">Rates</h1>
      <p className="page-subtitle">
        What we charge, ex GST: labour by the role worked, plant by the machine, and materials. A company rate applies on
        every job; a rate for this job replaces the company one of the same name here only — use it where the head
        contract’s schedule of rates differs. Variation build-ups price from this card, and a line keeps the rate it was
        added at, so changing a rate here never moves a variation already priced.
      </p>
      <RatesScreen
        orgId={orgId}
        projectId={current.project_id}
        projectCode={current.project.code}
        orgName={current.project.org.name}
        rates={items}
        plant={((plant ?? []) as Array<{ id: string; name: string; plant_no: string | null; active: boolean }>)}
        lastChange={lastChange}
        canWrite={office}
      />
    </main>
  );
}
