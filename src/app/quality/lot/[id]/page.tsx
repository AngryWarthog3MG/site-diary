import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { isUuid } from '@/lib/api';
import { perthToday } from '@/lib/push/decide';
import { itpRef, lotRef, type LotStatus, type PointType, type Result, type NcrStatus, type Disposition } from '@/lib/quality/model';
import { LotScreen } from './lot-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lot · KBS Daily Diary' };

export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'quality');

  const supabase = await createClient();
  const { data: lot } = await supabase
    .from('lots')
    .select('id, project_id, seq, itp_id, description, location, surveyed_position, status, replaces_lot_id, opened_at, closed_at, close_note')
    .eq('id', id)
    .maybeSingle();
  if (!lot || lot.project_id !== current.project_id) notFound();

  const [{ data: itp }, { data: checks }, { data: releases }, { data: ncrs }, { data: equipment }, { data: replacement }, { data: original }] = await Promise.all([
    supabase.from('itps').select('id, code, revision, title, itp_points(id, seq, activity, inspection_test, acceptance_criteria, method, frequency, responsible, point_type, uses_calibrated_equipment, record_required)').eq('id', lot.itp_id).single(),
    supabase.from('lot_checks').select('id, itp_point_id, result, measured, test_reference, equipment_id, checked_on, notes, created_at').eq('lot_id', id).order('created_at'),
    supabase.from('hold_point_releases').select('id, itp_point_id, released_at, released_by_name, authority, note').eq('lot_id', id),
    supabase.from('ncrs').select('id, seq, itp_point_id, status, disposition, observation').eq('lot_id', id).order('seq'),
    supabase.from('measuring_equipment').select('id, name, serial_no, active, equipment_calibrations(calibrated_on, due_on, certificate_no)').eq('org_id', current.project.org.id).eq('active', true).order('name'),
    supabase.from('lots').select('id, seq').eq('replaces_lot_id', id).maybeSingle(),
    lot.replaces_lot_id ? supabase.from('lots').select('id, seq').eq('id', lot.replaces_lot_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const q = `?project=${current.project_id}`;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{lotRef(lot.seq as number)}</h1>
      <p className="page-subtitle">
        {lot.description as string} · {lot.location as string}
        {itp ? <> · worked to <Link href={`/quality/itp/${itp.id}${q}`}>{itpRef(itp.code as string, itp.revision as number)}</Link></> : null}
      </p>
      {original && <p className="caption">Replaces <Link href={`/quality/lot/${original.id}${q}`}>{lotRef(original.seq as number)}</Link>.</p>}
      {replacement && <p className="caption">Replaced by <Link href={`/quality/lot/${replacement.id}${q}`}>{lotRef(replacement.seq as number)}</Link>.</p>}
      <LotScreen
        lot={{
          id: lot.id as string, projectId: lot.project_id as string, itpId: lot.itp_id as string, seq: lot.seq as number,
          description: lot.description as string, location: lot.location as string, surveyedPosition: (lot.surveyed_position as string | null) ?? null,
          status: lot.status as LotStatus, closeNote: (lot.close_note as string | null) ?? null, hasReplacement: Boolean(replacement),
        }}
        points={(((itp?.itp_points ?? []) as Array<{ id: string; seq: number; activity: string; inspection_test: string; acceptance_criteria: string; method: string | null; frequency: string; responsible: string; point_type: PointType; uses_calibrated_equipment: boolean; record_required: string | null }>)).sort((a, b) => a.seq - b.seq)}
        checks={(checks ?? []) as Array<{ id: string; itp_point_id: string; result: Result; measured: string | null; test_reference: string | null; equipment_id: string | null; checked_on: string; notes: string | null; created_at: string }>}
        releases={(releases ?? []) as Array<{ id: string; itp_point_id: string; released_at: string; released_by_name: string; authority: string | null; note: string | null }>}
        ncrs={(ncrs ?? []) as Array<{ id: string; seq: number; itp_point_id: string | null; status: NcrStatus; disposition: Disposition | null; observation: string }>}
        equipment={(equipment ?? []) as Array<{ id: string; name: string; serial_no: string | null; active: boolean; equipment_calibrations: Array<{ calibrated_on: string; due_on: string; certificate_no: string }> }>}
        today={perthToday()}
        canRun={canRunTalks(current.role)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/quality${q}`}>Back to quality</Link>
    </main>
  );
}
