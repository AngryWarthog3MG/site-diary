import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isUuid } from '@/lib/api';
import { PLANT_KIND_LABEL, isPlantKind } from '@/lib/plant/checklist';
import type { InspectionBasis, RecordKind, Outcome } from '@/lib/plant/inspections';
import { MachineScreen } from './machine-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Machine · Kooboolong IMS' };

/**
 * One machine on the company's fleet: on what basis it is inspected and when it
 * is next due, whether it must be registered, and every inspection, test and
 * repair on record with who did it and on what competence.
 *
 * WHS (General) Regulations 2022 (WA) regs 213 and 237; WHS Act 2020 (WA) s. 42.
 */
export default async function MachinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'plant');

  const supabase = await createClient();
  const [{ data: machine }, { data: records }] = await Promise.all([
    supabase
      .from('plant_register')
      .select('id, org_id, name, kind, make_model, plant_no, ownership, supplier, active, inspection_basis, inspection_interval_months, registration_required, registration_kind, registration_no, registration_expires_on')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('plant_maintenance_records')
      .select('id, kind, done_on, performed_by_name, competence, organisation, hour_meter, outcome, findings, next_due_on, file_path, created_at')
      .eq('plant_id', id)
      .order('done_on', { ascending: false }),
  ]);
  // RLS scopes the register to the organisation; the address must also be this job's organisation's.
  if (!machine || machine.org_id !== current.project.org.id) notFound();

  const kind = machine.kind as string;
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">{machine.name as string}</h1>
      <p className="page-subtitle">
        {[isPlantKind(kind) ? PLANT_KIND_LABEL[kind] : kind, machine.plant_no as string | null, machine.make_model as string | null].filter(Boolean).join(' · ')}
      </p>
      <MachineScreen
        machine={{
          id: machine.id as string,
          orgId: machine.org_id as string,
          inspection_basis: (machine.inspection_basis as InspectionBasis | null) ?? null,
          inspection_interval_months: (machine.inspection_interval_months as number | null) ?? null,
          registration_required: Boolean(machine.registration_required),
          registration_kind: (machine.registration_kind as 'item' | 'design' | null) ?? null,
          registration_no: (machine.registration_no as string | null) ?? null,
          registration_expires_on: (machine.registration_expires_on as string | null) ?? null,
        }}
        records={((records ?? []) as Array<{ id: string; kind: RecordKind; done_on: string; performed_by_name: string; competence: string | null; organisation: string | null; hour_meter: number | string | null; outcome: Outcome | null; findings: string | null; next_due_on: string | null; file_path: string | null; created_at: string }>)
          .map((r) => ({ ...r, hour_meter: r.hour_meter == null ? null : Number(r.hour_meter) }))}
        today={perthToday()}
        canEdit={canRunTalks(current.role)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/plant?project=${current.project_id}`}>Back to plant</Link>
    </main>
  );
}
