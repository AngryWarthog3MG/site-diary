import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { HomeFoot } from '@/components/home-foot';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, moneyState } from '@/lib/auth';
import { MoneyLock } from '@/components/money-lock';
import { canManageRegisters, seesMoney } from '@/lib/roles';
import { isUuid } from '@/lib/api';
import { perthToday } from '@/lib/push/decide';
import { loadBuildUp } from '@/lib/variations/load';
import { registerNumber } from '@/lib/claims/register';
import { BuildUp } from './build-up';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Variation build-up · Kooboolong IMS' };

/**
 * One variation's cost build-up (README R104): the labour, plant and materials behind it, each at its rate, the
 * total that becomes the variation's claim, and the diary days it stands on. Reached from the tracker and from the
 * day's Variations tab; everything on it points back to the variation.
 */
export default async function BuildUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { memberships, aal } = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await loadBuildUp(await createClient(), id);
  if (!data) notFound();
  const current = resolveProject(memberships, data.register.project_id);
  if (!current) redirect('/variations');
  guardScreen(current, 'variations');
  // The build-up is money (README R105).
  if (!seesMoney(current)) redirect(`/variations?project=${current.project_id}`);
  const money = moneyState(current, aal);
  if (money !== 'open') {
    return (
      <main className="sheet">
        <Suspense fallback={null}>
          <HomeFoot at="top" />
        </Suspense>
        <h1 className="page-title">{registerNumber(data.register.seq)} · {data.register.title}</h1>
        <MoneyLock state={money} next={`/variations/${data.register.id}?project=${current.project_id}`} />
      </main>
    );
  }

  return (
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{registerNumber(data.register.seq)} · {data.register.title}</h1>
      <p className="page-subtitle">
        What this variation is made of — the labour, the machines and the materials, each at its rate. The total is the
        variation’s claim on the tracker and on the day’s Variations tab. Rates come from the rate card; a line keeps the
        rate it was added at.
      </p>
      <BuildUp data={data} canManage={canManageRegisters(current.role)} today={perthToday()} />
    </main>
  );
}
