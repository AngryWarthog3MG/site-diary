import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isUuid } from '@/lib/api';
import type { SdsFacts } from '@/lib/chemicals/model';
import { ProductScreen } from './product-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chemical · KBS Daily Diary' };

/**
 * One chemical: what the label says, every safety data sheet it has ever had,
 * and whether it is on this site. Sheets are records — a new one supersedes
 * the old, and the old is retired rather than deleted, so the register can
 * still say what the crew was working to last March.
 */
export default async function ChemicalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'chemicals')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const { data } = await supabase
    .from('chemical_products')
    .select('id, org_id, name, manufacturer, product_code, hazard_classes, dg_class, used_for, notes, active, chemical_sds(id, issued_on, version, file_path, active, created_at)')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();

  const { data: links } = await supabase
    .from('project_chemicals')
    .select('project_id, location, quantity, active, project:projects!inner(name, code)')
    .eq('product_id', id)
    .eq('active', true);

  const onThisJob = (links ?? []).find((l) => l.project_id === current.project_id) as
    | { location: string | null; quantity: string | null } | undefined;
  const elsewhere = (links ?? [])
    .filter((l) => l.project_id !== current.project_id)
    .map((l) => {
      const p = (Array.isArray(l.project) ? l.project[0] : l.project) as { name: string } | null;
      return p?.name ?? '';
    })
    .filter(Boolean);

  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">{data.name as string}</h1>
      <p className="page-subtitle">
        {[data.manufacturer as string | null, data.used_for as string | null].filter(Boolean).join(' · ') ||
          'What the label says, and the safety data sheet the register is holding.'}
      </p>

      <ProductScreen
        product={{
          id: data.id as string,
          orgId: data.org_id as string,
          name: data.name as string,
          manufacturer: (data.manufacturer as string | null) ?? null,
          hazardClasses: (data.hazard_classes as string[] | null) ?? [],
          dgClass: (data.dg_class as string | null) ?? null,
          usedFor: (data.used_for as string | null) ?? null,
          active: data.active as boolean,
          sheets: ((data.chemical_sds ?? []) as SdsFacts[]),
        }}
        projectId={current.project_id}
        userId={userId}
        today={perthToday()}
        onThisJob={onThisJob ? { location: onThisJob.location, quantity: onThisJob.quantity } : null}
        elsewhere={elsewhere}
        canKeepList={canAuthorEntries(current.role)}
        canPutOnSite={canRunTalks(current.role)}
      />

      <hr className="rule" />
      <Link className="button button--quiet" href={`/chemicals${q}`}>Back to the register</Link>
    </main>
  );
}
