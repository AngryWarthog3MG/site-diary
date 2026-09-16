import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { EquipmentScreen } from './equipment-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calibration register · KBS Daily Diary' };

/**
 * The company's measuring equipment and its calibrations (ISO 9001 cl. 7.1.5).
 * An ITP point that uses calibrated equipment cannot take a check with a gauge
 * that was out of calibration on the day — this register is what decides it.
 */
export default async function EquipmentPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'quality');

  const supabase = await createClient();
  const { data } = await supabase
    .from('measuring_equipment')
    .select('id, name, serial_no, kind, calibration_interval_months, active, equipment_calibrations(id, calibrated_on, due_on, certificate_no, calibrated_by)')
    .eq('org_id', current.project.org.id)
    .order('active', { ascending: false })
    .order('name');

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Calibration register</h1>
      <p className="page-subtitle">Gauges, levels, density meters — each with the certificate that says it measures true, and when that runs out.</p>
      <EquipmentScreen
        orgId={current.project.org.id}
        equipment={(data ?? []) as Array<{ id: string; name: string; serial_no: string | null; kind: string | null; calibration_interval_months: number | null; active: boolean; equipment_calibrations: Array<{ id: string; calibrated_on: string; due_on: string; certificate_no: string; calibrated_by: string | null }> }>}
        today={perthToday()}
        canManage={canAuthorEntries(current.role)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/quality?project=${current.project_id}`}>Back to quality</Link>
    </main>
  );
}
