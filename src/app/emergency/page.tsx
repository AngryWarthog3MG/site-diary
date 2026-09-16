import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { loadEmergency } from '@/lib/emergency/load';
import { perthDayOf } from '@/lib/emergency/model';
import { dueStatus, STATUS_LABEL } from '@/lib/obligations/model';
import { PlanForm } from './plan-form';
import { DrillForm } from './drill-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Emergency plan · KBS Daily Diary' };

/**
 * The emergency plan for this workplace, readable by everyone on it — in an
 * emergency the labourer is the one who needs the muster point — and the drills
 * that test it, which are management's evidence.
 *
 * WHS (General) Regulations 2022 (WA) reg. 43; ISO 45001 cl. 8.2.
 */
export default async function EmergencyPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'emergency')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const today = perthToday();
  const data = await loadEmergency(supabase, current.project_id);
  const plan = data.current;
  const canIssue = canAuthorEntries(current.role);
  const canDrill = canRunTalks(current.role);
  const readsDrills = current.role !== 'labourer';
  const drillStatus = data.nextDrillDue ? dueStatus(data.nextDrillDue, today) : null;

  return (
    <main className="sheet emerg">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Emergency plan</h1>

      <a className="emerg__call" href="tel:000">In an emergency call <strong>000</strong></a>

      {!plan ? (
        <>
          <p className="nil" style={{ marginTop: '1rem' }}>
            No emergency plan for this workplace yet. The law asks for one per workplace, written for this site —
            where to muster, where the nearest hospital is, who to call, and how often the procedures are tested.
          </p>
          {!canIssue && <p className="caption">Your supervisor sets it up.</p>}
        </>
      ) : (
        <>
          <section className="emerg__plan">
            <div className="emerg__key">
              <p className="label">Muster point</p>
              <p className="emerg__big">{plan.muster_point}</p>
            </div>
            {plan.site_address && (
              <div className="emerg__key">
                <p className="label">Site address — give this to 000</p>
                <p className="emerg__mid">{plan.site_address}</p>
              </div>
            )}
            {plan.nearest_hospital && (
              <div className="emerg__key">
                <p className="label">Nearest hospital</p>
                <p className="emerg__mid">{plan.nearest_hospital}</p>
              </div>
            )}
            <dl className="regpanel__facts emerg__facts">
              {plan.first_aiders.length > 0 && (<><dt>First aiders</dt><dd>{plan.first_aiders.join(', ')}</dd></>)}
              {plan.first_aid_location && (<><dt>First aid kit</dt><dd>{plan.first_aid_location}</dd></>)}
              {plan.fire_equipment_location && (<><dt>Fire equipment</dt><dd>{plan.fire_equipment_location}</dd></>)}
              {plan.emergency_contacts && (<><dt>Who to call</dt><dd className="emerg__pre">{plan.emergency_contacts}</dd></>)}
            </dl>
            <div className="item">
              <p className="label">Evacuation</p>
              <p className="emerg__pre">{plan.evacuation_procedure}</p>
            </div>
            {plan.notify_procedure && (
              <div className="item">
                <p className="label">Who tells whom</p>
                <p className="emerg__pre">{plan.notify_procedure}</p>
              </div>
            )}
            {plan.spill_response && (
              <div className="item">
                <p className="label">Spills</p>
                <p className="emerg__pre">{plan.spill_response}</p>
              </div>
            )}
            {plan.site_hazards && (
              <div className="item">
                <p className="label">Hazards on this site</p>
                <p className="emerg__pre">{plan.site_hazards}</p>
              </div>
            )}
            <p className="caption" style={{ marginTop: '0.75rem' }}>
              Version {plan.version} · issued {fmtDate(perthDayOf(plan.issued_at))} · procedures tested every {plan.test_every_months} month{plan.test_every_months === 1 ? '' : 's'}
              {plan.training_note ? ` · ${plan.training_note}` : ''}
            </p>
          </section>

          {readsDrills && (
            <section style={{ marginTop: '1.25rem' }}>
              <hr className="rule" />
              <p className="label">Drills</p>
              <p className={drillStatus === 'overdue' ? 'vr-missing' : undefined} style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
                {data.nextDrillDue ? `${STATUS_LABEL[drillStatus!]} · next drill due ${fmtDate(data.nextDrillDue)}` : ''}
              </p>
              <p className="caption">{data.lastDrillOn ? `Last held ${fmtDate(data.lastDrillOn)}.` : 'No drill held on this workplace yet.'}</p>
              {data.drills.length > 0 && (
                <ul className="gaplist">
                  {data.drills.map((d) => {
                    const version = data.plans.find((p) => p.id === d.plan_id)?.version;
                    return (
                      <li key={d.id}>
                        <strong>{fmtDate(d.held_on)}</strong> · {d.scenario}
                        {d.participants != null ? ` · ${d.participants} took part` : ''}
                        {d.muster_minutes != null ? ` · mustered in ${d.muster_minutes} min` : ''}
                        {version ? ` · plan v${version}` : ''}
                        {(d.went_well || d.to_improve) && (
                          <><br /><span className="caption">{[d.went_well && `Went well: ${d.went_well}`, d.to_improve && `To improve: ${d.to_improve}`].filter(Boolean).join(' · ')}</span></>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canDrill && <DrillForm projectId={current.project_id} planId={plan.id} today={today} />}
            </section>
          )}

          {data.plans.length > 1 && (
            <details style={{ marginTop: '1rem' }}>
              <summary className="caption">Earlier versions of this plan</summary>
              <ul className="gaplist">
                {data.plans.filter((p) => p.id !== plan.id).map((p) => (
                  <li key={p.id}>Version {p.version} · issued {fmtDate(perthDayOf(p.issued_at))} · muster point {p.muster_point}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {canIssue && <PlanForm projectId={current.project_id} current={plan} />}

      <hr className="rule" />
      <p className="caption">
        Kept under the Work Health and Safety (General) Regulations 2022 (WA) reg. 43. A version, once issued, does not change;
        a change is a new version, so the plan in force on any day can be shown.
      </p>
    </main>
  );
}
