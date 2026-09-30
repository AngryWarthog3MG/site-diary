import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { readKind } from '@/lib/registers/kinds';
import { calibrationRegister, chemicalsRegister, plantRegister, type CalibrationRow, type ChemLine, type EquipmentRow, type PlantRecord } from '@/lib/registers/model';
import type { SdsFacts } from '@/lib/chemicals/model';
import { RegistersScreen } from './registers-screen';
import { PlantEditor, type Job, type Machine, type PlantLink } from './plant-editor';
import { ChemicalsEditor, type OnSite, type Product } from './chemicals-editor';
import { CalibrationEditor } from './calibration-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Registers · Kooboolong IMS' };

/**
 * Registers (README R118): the company's registers on one page, chosen from a
 * dropdown and edited in place. What is saved here is the record itself — the
 * same rows Plant, Chemicals, Quality, the diary and the printed registers
 * read — so a change made here is a change everywhere, with nothing copied.
 */
export default async function RegistersPage({ searchParams }: { searchParams: Promise<{ project?: string; r?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project, r } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'registers');

  const kind = readKind(r);
  const supabase = await createClient();
  const org = current.project.org;
  const today = perthToday();
  // The company's jobs this account holds and that are awake: the ones a machine can be ticked onto from here.
  const jobs: Job[] = memberships
    .filter((m) => m.project.org.id === org.id && m.project.active)
    .map((m) => ({ id: m.project.id, code: m.project.code, name: m.project.name }))
    .sort((a, b) => a.code.localeCompare(b.code));

  let summary: string[] = [];
  let body: React.ReactNode = null;

  if (kind === 'plant') {
    const [{ data: plant, error }, { data: records }, { data: links }] = await Promise.all([
      supabase.from('plant_register')
        .select('id, name, kind, make_model, plant_no, ownership, supplier, active, inspection_basis, inspection_interval_months, registration_required, registration_kind, registration_no, registration_expires_on')
        .eq('org_id', org.id),
      supabase.from('plant_maintenance_records')
        .select('plant_id, kind, done_on, next_due_on, outcome, performed_by_name, organisation, plant:plant_register!inner(org_id)')
        .eq('plant.org_id', org.id),
      supabase.from('project_plant').select('plant_id, project_id, active').in('project_id', jobs.map((j) => j.id)),
    ]);
    if (error) throw new Error(`Could not read the plant register: ${error.message}`);
    const machines = (plant ?? []) as Machine[];
    const recs = ((records ?? []) as unknown) as PlantRecord[];
    const lk = (links ?? []) as PlantLink[];
    const codeOf = new Map(jobs.map((j) => [j.id, j.code]));
    const jobsByPlant = new Map<string, string[]>();
    for (const l of lk) if (l.active && codeOf.has(l.project_id)) jobsByPlant.set(l.plant_id, [...(jobsByPlant.get(l.plant_id) ?? []), codeOf.get(l.project_id)!]);
    summary = plantRegister(machines, recs, jobsByPlant, today).summary;
    body = <PlantEditor orgId={org.id} projectId={current.project_id} jobs={jobs} today={today} userId={userId} machines={machines} records={recs} links={lk} />;
  } else if (kind === 'chemicals') {
    const [{ data: products, error }, { data: links }] = await Promise.all([
      supabase.from('chemical_products')
        .select('id, name, manufacturer, product_code, hazard_classes, dg_class, used_for, notes, active, chemical_sds(id, issued_on, version, file_path, active)')
        .eq('org_id', org.id),
      supabase.from('project_chemicals').select('product_id, location, quantity, active').eq('project_id', current.project_id),
    ]);
    if (error) throw new Error(`Could not read the chemicals register: ${error.message}`);
    const list: Product[] = ((products ?? []) as Array<Omit<Product, 'sheets' | 'hazard_classes'> & { hazard_classes: string[] | null; chemical_sds: SdsFacts[] | null }>)
      .map(({ chemical_sds, hazard_classes, ...p }) => ({ ...p, hazard_classes: hazard_classes ?? [], sheets: chemical_sds ?? [] }));
    const onSite = (links ?? []) as OnSite[];
    const here = new Map(onSite.filter((l) => l.active).map((l) => [l.product_id, l]));
    const line = (p: Product): ChemLine => ({
      name: p.name, manufacturer: p.manufacturer, product_code: p.product_code, hazardClasses: p.hazard_classes, dgClass: p.dg_class, usedFor: p.used_for,
      location: here.get(p.id)?.location ?? null, quantity: here.get(p.id)?.quantity ?? null, sheets: p.sheets,
    });
    summary = chemicalsRegister(list.filter((p) => here.has(p.id)).map(line), list.filter((p) => !here.has(p.id) && p.active).map(line), today).summary;
    body = <ChemicalsEditor orgId={org.id} projectId={current.project_id} jobLabel={`${current.project.code} · ${current.project.name}`} today={today} userId={userId} products={list} onSite={onSite} />;
  } else {
    const { data, error } = await supabase.from('measuring_equipment')
      .select('id, name, serial_no, kind, calibration_interval_months, active, equipment_calibrations(calibrated_on, due_on, certificate_no, calibrated_by)')
      .eq('org_id', org.id);
    if (error) throw new Error(`Could not read the calibration register: ${error.message}`);
    const equipment: EquipmentRow[] = ((data ?? []) as Array<Omit<EquipmentRow, 'calibrations'> & { equipment_calibrations: CalibrationRow[] | null }>)
      .map(({ equipment_calibrations, ...e }) => ({ ...e, calibrations: equipment_calibrations ?? [] }));
    summary = calibrationRegister(equipment, today).summary;
    body = <CalibrationEditor orgId={org.id} projectId={current.project_id} today={today} userId={userId} equipment={equipment} />;
  }

  return (
    <main className="sheet regs">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Registers</h1>
      <p className="page-subtitle">
        The company&rsquo;s registers on one page. Pick one, tap Edit on a line, save. What you change here is the record
        itself, so Plant, Chemicals, Quality, the diary and the printed registers all read it at once.
      </p>
      <RegistersScreen kind={kind} projectId={current.project_id} summary={summary}>
        {body}
      </RegistersScreen>
    </main>
  );
}
