import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { perthDayOf } from '@/lib/emergency/model';
import { TRENCH_CONTROL_LABEL, servicesInfoCurrency, withoutWhiteCard, type TrenchControl } from '@/lib/construction/model';
import { PrincipalToggle, WhsPlanForm } from './whs-plan-form';
import { ExcavationForm } from './excavation-form';
import { PlansLink } from './plans-link';
import { HeadContractorSection } from './head-contractor-section';
import { OutboxStatus } from '@/components/outbox-status';
import type { HcDoc } from '@/lib/subcontract/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Construction records · KBS Daily Diary' };

interface WhsPlan {
  id: string; version: number; responsibilities: string; consultation_arrangements: string; incident_arrangements: string;
  site_rules: string; swms_arrangements: string; other_matters: string | null; revision_reason: string | null; issued_at: string;
}

/**
 * The records Chapter 6 of the WHS (General) Regulations 2022 (WA) asks of a
 * construction contractor that the rest of the app does not already keep: the
 * principal contractor's WHS management plan (regs 309–313), the services
 * information and trench controls for each excavation (regs 304, 306), and
 * which of the crew have no white card recorded (reg. 317).
 */
export default async function ConstructionPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'construction')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const today = perthToday();
  const [{ data: proj }, { data: planRows }, { data: excRows }, { data: crewRows }, { data: ticketRows }, { data: hcDocs }] = await Promise.all([
    supabase.from('projects').select('is_principal_contractor, principal_contractor, head_contractor_incident_hours').eq('id', current.project_id).single(),
    supabase.from('whs_management_plans').select('id, version, responsibilities, consultation_arrangements, incident_arrangements, site_rules, swms_arrangements, other_matters, revision_reason, issued_at').eq('project_id', current.project_id).order('version', { ascending: false }),
    supabase.from('excavation_records').select('id, location, planned_start_on, info_source, info_reference, info_obtained_on, info_valid_until, services_identified, plans_file_path, services_located_by, locating_method, located_on, max_depth_m, trench_control, engineer_advice_ref, notes, created_at').eq('project_id', current.project_id).order('created_at', { ascending: false }),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true),
    supabase.from('crew_tickets').select('person_name, ticket_type, active, expires_on').eq('org_id', current.project.org.id).eq('ticket_type', 'white_card'),
    supabase.from('head_contractor_documents').select('id, kind, title, revision, received_on, file_path, superseded_by, notes').eq('project_id', current.project_id),
  ]);

  const isPC = Boolean(proj?.is_principal_contractor);
  const plans = (planRows ?? []) as WhsPlan[];
  const plan = plans[0] ?? null;
  const excavations = (excRows ?? []) as Array<{ id: string; location: string; planned_start_on: string | null; info_source: string; info_reference: string; info_obtained_on: string; info_valid_until: string | null; services_identified: string | null; plans_file_path: string | null; services_located_by: string | null; locating_method: string | null; located_on: string | null; max_depth_m: number | string | null; trench_control: TrenchControl | null; engineer_advice_ref: string | null; notes: string | null; created_at: string }>;
  const crew = ((crewRows ?? []) as Array<{ name: string }>).map((c) => c.name);
  const noCard = withoutWhiteCard(crew, (ticketRows ?? []) as Array<{ person_name: string; ticket_type: string; active: boolean; expires_on: string | null }>, today);
  const isAdmin = current.role === 'admin';

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Construction records</h1>
      <p className="page-subtitle">
        The head contractor&rsquo;s plans you work to — or your own WHS management plan when you are principal contractor — the
        services and trench record for every dig, and the white cards on the crew list.
      </p>

      <OutboxStatus />
      {!isPC && (
        <HeadContractorSection
          projectId={current.project_id}
          contractor={(proj?.principal_contractor as string | null) ?? null}
          hours={(proj?.head_contractor_incident_hours as number | null) ?? null}
          docs={(hcDocs ?? []) as HcDoc[]}
          today={today}
          canManage={canAuthorEntries(current.role)}
          isAdmin={isAdmin}
        />
      )}

      <section style={{ marginTop: '1rem' }}>
        <hr className="rule" />
        <p className="label">WHS management plan</p>
        <PrincipalToggle projectId={current.project_id} isPrincipal={isPC} canChange={isAdmin} />
        {!isPC ? (
          <p className="caption">
            The head contractor is principal contractor and holds the plan (regs 309–313). Record the copy you work to under
            their plans above.
          </p>
        ) : !plan ? (
          <p className="nil vr-missing">
            No WHS management plan. As principal contractor it must be written before work starts (reg. 309) — and in WA this
            applies once five or more people work on the site at the same time (reg. 292).
          </p>
        ) : (
          <div className="emerg__plan">
            {([
              ['Who is responsible for what', plan.responsibilities],
              ['Consultation and coordination between businesses', plan.consultation_arrangements],
              ['Managing incidents', plan.incident_arrangements],
              ['Site rules, and how people are told', plan.site_rules],
              ['Collecting, checking and reviewing SWMS', plan.swms_arrangements],
              ...(plan.other_matters ? [['Other', plan.other_matters]] : []),
            ] as Array<[string, string]>).map(([label, text]) => (
              <div key={label} className="item"><p className="label">{label}</p><p className="emerg__pre">{text}</p></div>
            ))}
            <p className="caption">
              Version {plan.version} · issued {fmtDate(perthDayOf(plan.issued_at))}{plan.revision_reason ? ` · ${plan.revision_reason}` : ''}
              {plans.length > 1 ? ` · ${plans.length - 1} earlier version${plans.length === 2 ? '' : 's'} kept` : ''}
            </p>
          </div>
        )}
        {isPC && canAuthorEntries(current.role) && <WhsPlanForm projectId={current.project_id} current={plan} />}
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <hr className="rule" />
        <p className="label">Excavations — underground services and trenches</p>
        <p className="caption">
          Before digging: the services information, where it came from, and who located them (reg. 304). At 1.5 m or deeper:
          how the trench is held up (reg. 306). Kept until the work is finished, and longer after a notifiable incident.
        </p>
        {excavations.length === 0 ? (
          <p className="nil">No excavations recorded on this job.</p>
        ) : (
          <ul className="gaplist">
            {excavations.map((e) => {
              const depth = e.max_depth_m == null ? null : Number(e.max_depth_m);
              const currency = servicesInfoCurrency(e.info_valid_until, today);
              return (
                <li key={e.id}>
                  <strong>{e.location}</strong>
                  {e.planned_start_on ? ` · from ${fmtDate(e.planned_start_on)}` : ''}
                  <br />
                  <span className="caption">
                    {e.info_source} {e.info_reference} · obtained {fmtDate(e.info_obtained_on)}
                    {e.info_valid_until ? <span className={currency === 'expired' ? 'vr-missing' : undefined}> · {currency === 'expired' ? 'expired' : 'valid until'} {fmtDate(e.info_valid_until)}</span> : ''}
                    {e.plans_file_path ? <> · <PlansLink path={e.plans_file_path} /></> : ''}
                  </span>
                  {e.services_identified && <><br /><span className="caption">Services: {e.services_identified}</span></>}
                  {(e.services_located_by || e.located_on) && (
                    <><br /><span className="caption">Located{e.services_located_by ? ` by ${e.services_located_by}` : ''}{e.locating_method ? `, ${e.locating_method}` : ''}{e.located_on ? `, ${fmtDate(e.located_on)}` : ''}</span></>
                  )}
                  {depth != null && (
                    <><br /><span className="caption">Up to {depth} m deep{e.trench_control ? ` · ${TRENCH_CONTROL_LABEL[e.trench_control]}${e.engineer_advice_ref ? ` (${e.engineer_advice_ref})` : ''}` : ''}</span></>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canRunTalks(current.role) && <ExcavationForm projectId={current.project_id} today={today} />}
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <hr className="rule" />
        <p className="label">White cards</p>
        {crew.length === 0 ? (
          <p className="caption">No one on this job&rsquo;s crew list yet.</p>
        ) : noCard.length === 0 ? (
          <p className="caption">Everyone on the crew list has a white card recorded.</p>
        ) : (
          <p className="vr-missing" style={{ margin: '0.25rem 0 0' }}>
            No white card recorded for {noCard.join(', ')}. A worker may not be directed to carry out construction work without
            one (reg. 317) — record it in the training matrix.
          </p>
        )}
      </section>
    </main>
  );
}
