import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { canExportReports } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { PLANT_KIND_LABEL, isPlantKind } from '@/lib/plant/checklist';
import { PlantRegister, type RegisterRow } from './plant-register';
import { DefectList, type DefectRow } from './defect-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plant · KBS Daily Diary' };

/**
 * Plant: which machines have been walked around this morning, what is
 * tagged out, what is still open from earlier days, and the fleet itself.
 */
export default async function PlantPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;

  const supabase = await createClient();
  const orgId = current.project.org.id;
  const today = perthToday();
  const canRun = canRunTalks(current.role);
  const q = `?project=${current.project_id}`;

  const [{ data: register }, { data: todays }, { data: open }, { data: recent }, { data: onJobRows }] = await Promise.all([
    supabase.from('plant_register').select('id, name, kind, make_model, plant_no, ownership, supplier, active').eq('org_id', orgId).order('active', { ascending: false }).order('name'),
    supabase.from('plant_prestarts').select('id, plant_id, operator_name, fit_for_use, completed_at').eq('project_id', current.project_id).eq('prestart_date', today).not('completed_at', 'is', null).order('completed_at', { ascending: false }),
    supabase.from('plant_defects').select('id, plant_id, item_label, note, raised_at, plant:plant_register!inner(name)').eq('project_id', current.project_id).is('closed_at', null).order('raised_at', { ascending: false }),
    supabase.from('plant_prestarts').select('id, prestart_date, operator_name, fit_for_use, completed_at, plant:plant_register!inner(name)').eq('project_id', current.project_id).not('completed_at', 'is', null).order('prestart_date', { ascending: false }).order('completed_at', { ascending: false }).limit(40),
    supabase.from('project_plant').select('plant_id, active, sort_order').eq('project_id', current.project_id),
  ]);
  const onJob = new Set((onJobRows ?? []).filter((r) => r.active).map((r) => r.plant_id as string));
  const order = new Map((onJobRows ?? []).map((r) => [r.plant_id as string, (r.sort_order as number) ?? 0]));

  const rows = (register ?? []) as RegisterRow[];
  // Today's list is the machines on this job; the fleet is further down.
  const active = rows.filter((r) => r.active && onJob.has(r.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.name.localeCompare(b.name));
  const byPlant = new Map<string, { fit: boolean; operator: string }>();
  for (const t of todays ?? []) if (!byPlant.has(t.plant_id as string)) byPlant.set(t.plant_id as string, { fit: Boolean(t.fit_for_use), operator: t.operator_name as string });
  const name = (v: unknown) => ((Array.isArray(v) ? v[0] : v) as { name?: string } | null)?.name ?? '—';
  const defects: DefectRow[] = (open ?? []).map((d) => ({ id: d.id as string, plant: name(d.plant), item: d.item_label as string, note: (d.note as string | null) ?? null, raised: d.raised_at as string }));
  const month = `${today.slice(0, 7)}-01`;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Plant</h1>
      <p className="page-subtitle">
        Every machine gets a walk-around before it starts: fluids, leaks, tracks or tyres, lights,
        guards, the bits that fall off. The operator answers each check and signs; a defect tags
        the machine until someone closes it.
      </p>
      {canRun && <Link className="button" href={`/plant/new${q}`}>Start a plant prestart</Link>}
      <hr className="rule" />

      <p className="label">Today · {fmtDate(today)}</p>
      {active.length === 0 ? (
        <p className="notice gap">No machines on this job yet. Tick them in the register below, or add one.</p>
      ) : (
        <ul className="machines">
          {active.map((m) => {
            const t = byPlant.get(m.id);
            const state = !t ? 'none' : t.fit ? 'fit' : 'tagged';
            return (
              <li key={m.id} className={`machine machine--${state}`}>
                <div>
                  <p className="machine__name">{m.name}</p>
                  <p className="machine__meta">
                    {[isPlantKind(m.kind) ? PLANT_KIND_LABEL[m.kind] : null, m.plant_no].filter(Boolean).join(' · ')}
                    {t ? ` · ${t.operator}` : ''}
                  </p>
                </div>
                {state === 'fit' && <span className="status-pill status-pill--ready">Fit for use</span>}
                {state === 'tagged' && <span className="status-pill status-pill--danger">Not to be used</span>}
                {state === 'none' && (canRun
                  ? <Link className="status-pill status-pill--gap" href={`/plant/new${q}&plant=${m.id}`}>Not yet · check it</Link>
                  : <span className="status-pill status-pill--gap">Not yet</span>)}
              </li>
            );
          })}
        </ul>
      )}

      <hr className="rule" />
      <p className="label">Open defects · {defects.length}</p>
      <DefectList projectId={current.project_id} initial={defects} canClose={canRun} />

      <hr className="rule" />
      <p className="label">Recent prestarts</p>
      {(recent ?? []).length === 0 ? (
        <p className="caption">None signed yet.</p>
      ) : (
        <ul className="register-list">
          {(recent ?? []).map((r) => (
            <li key={r.id as string}>
              <Link className="register-card" href={`/plant/${r.id}`}>
                <div className="register-card__main">
                  <p className="register-card__title">{name(r.plant)}</p>
                  <p className="register-card__meta">{fmtDate(r.prestart_date as string)} · {r.operator_name as string}</p>
                </div>
                <span className={`status-pill ${r.fit_for_use ? 'status-pill--ready' : 'status-pill--danger'}`}>{r.fit_for_use ? 'Fit' : 'Not to be used'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canExportReports(current.role) && (
        <a className="linklike" href={`/api/plant/export?project=${current.project_id}&from=${month}&to=${today}`}>
          Download this month&rsquo;s plant prestarts as a spreadsheet
        </a>
      )}

      <hr className="rule" />
      <p className="label">Plant register · the whole company</p>
      <p className="caption">
        One list for every job. Tick <b>On this job</b> for the machines here — that is what the diary, the
        review screen and today&rsquo;s prestarts read. Anyone who runs prestarts can add a machine; one no
        longer around is retired, never deleted.
      </p>
      <PlantRegister orgId={orgId} projectId={current.project_id} initial={rows} onJob={[...onJob]} canEdit={canRun} />

      <Link className="button button--quiet" href="/">Home</Link>
    </main>
  );
}
