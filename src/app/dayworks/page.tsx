import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, moneyState } from '@/lib/auth';
import { MoneyLock } from '@/components/money-lock';
import { fmtMoney } from '@/lib/money';
import { sees, canManageRegisters } from '@/lib/roles';
import { loadPlantOnJob } from '@/lib/plant/on-job';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { readRange, scheduleLines, type RangeKey } from '@/lib/dayworks/schedule';
import { loadDayworksSchedule, type DayworksScheduleData } from '@/lib/dayworks/load';
import { approvalOf, snapshotLines, type DayworkSignoff } from '@/lib/dayworks/signoff';
import { loadDayworksCosting, type DayworksCosting } from '@/lib/dayworks/costing-load';
import type { LineCost } from '@/lib/dayworks/costing';
import { RatesBlock } from './person-rates-block';
import { DayworksRow } from './dayworks-row';
import { SignoffBlock } from './signoff-block';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dayworks schedule · Kooboolong IMS' };

const hrs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/**
 * The dayworks schedule: every daywork on a signed day, the works completed,
 * who and what did it, the docket, and the hours — week by week, totalled —
 * for a period. Printable as the schedule that goes with a claim (README R72).
 * Each daywork is approved once the head contractor has signed for it — on this
 * screen, or on a paper sheet recorded here (README R125).
 */
export default async function DayworksPage({ searchParams }: { searchParams: Promise<{ project?: string; range?: string; from?: string; to?: string }> }) {
  const { memberships, aal } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'claims')) redirect(`/?project=${current.project_id}`);
  guardScreen(current, 'claims');

  const today = perthToday();
  const range = readRange(params, today);
  const supabase = await createClient();
  // Who signs the sheet: the head contractor we work under, when they are named.
  const { data: job } = await supabase.from('projects').select('principal_contractor').eq('id', current.project_id).maybeSingle();
  const clientName = (job?.principal_contractor as string | null)?.trim() || 'the head contractor';
  // Every sheet this job's client has signed. Refused for a labourer by RLS,
  // who does not reach this screen anyway.
  const { data: signoffRows } = await supabase
    .from('dayworks_signoffs')
    .select('id, period_from, period_to, period_label, items, hours, hours_not_recorded, photos, signed_by_name, signed_by_position, signed_on, file_path, note, signed_how, signature_path, declaration, signed_at, lines')
    .eq('project_id', current.project_id)
    .order('signed_on', { ascending: false });
  const signoffs = ((signoffRows ?? []) as unknown as DayworkSignoff[]).map((s) => ({ ...s, hours: Number(s.hours) }));

  let data: DayworksScheduleData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadDayworksSchedule(supabase, current.project_id, range);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Could not load the schedule.';
  }

  // Which of the period's dayworks the client has signed for, line by line (README R125).
  const lines = data ? scheduleLines(data) : [];
  const approval = approvalOf(lines, signoffs);
  const approvedBy = new Map(lines.map((l, i) => [l, approval.by[i]] as const));
  // The costing (README R158, R159): for a register keeper, each item's people and machines — the signed row's own
  // people, else the office's allocation — and, for someone who sees the money with their code entered, each at their
  // rate with the amounts. Anyone else sees the schedule as before.
  const money = moneyState(current, aal);
  const keeper = canManageRegisters(current.role);
  let costing: DayworksCosting | null = null;
  let costingError: string | null = null;
  let people: string[] = [];
  let machines: Array<{ id: string; name: string; plantNo: string | null }> = [];
  if (keeper && data) {
    try {
      const [c, crewRows, staffRows, onJob] = await Promise.all([
        loadDayworksCosting(supabase, current.project.org.id, current.project_id, data, lines, { money: money === 'open' }),
        supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
        supabase.from('staff').select('name').eq('org_id', current.project.org.id).eq('active', true).order('name'),
        loadPlantOnJob(supabase, current.project_id),
      ]);
      costing = c;
      // Who can be picked (R128): the job's crew list first, then the rest of the staff list.
      const seen = new Set<string>();
      for (const r of [...((crewRows.data ?? []) as Array<{ name: string }>), ...((staffRows.data ?? []) as Array<{ name: string }>)]) {
        const n = String(r.name ?? '').trim(); const k = n.toLowerCase();
        if (n && !seen.has(k)) { seen.add(k); people.push(n); }
      }
      machines = onJob.map((m) => ({ id: m.id, name: m.name, plantNo: m.plant_no }));
    } catch (err) { costingError = err instanceof Error ? err.message : 'Could not read the costing.'; }
  }
  const showMoney = Boolean(costing?.money);
  const costOf = new Map<(typeof lines)[number], LineCost>(costing ? lines.map((l, i) => [l, costing!.costs[i]] as const) : []);
  const weekCost = (i: number) => costing?.weeks[i] ?? null;
  const p = current.project_id;
  const href = (key: RangeKey) => `/dayworks?project=${p}${key === 'all' ? '' : `&range=${key}`}`;
  const pdfHref = `/api/dayworks/pdf?project=${p}${range.key === 'all' ? '' : `&range=${range.key}`}${range.key === 'custom' ? `${range.from ? `&from=${range.from}` : ''}${range.to ? `&to=${range.to}` : ''}` : ''}`;
  const chips: Array<[RangeKey, string]> = [['all', 'Whole job'], ['week', 'This week'], ['month', 'This month'], ['last-month', 'Last month']];

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Dayworks schedule</h1>
      <p className="page-subtitle">Every daywork on a signed day: the works completed, who and what did them, the docket, and the hours, totalled.</p>

      <nav className="chips" aria-label="Period" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.5rem' }}>
        {chips.map(([key, label]) => (
          <Link key={key} href={href(key)} className={`chip chip--link${range.key === key ? ' chip--on' : ''}`} aria-current={range.key === key ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>
      <form method="get" action="/dayworks" className="signin__grid" style={{ alignItems: 'end', marginBottom: '1rem' }}>
        <input type="hidden" name="project" value={p} />
        <input type="hidden" name="range" value="custom" />
        <label className="fieldcell"><span className="label">From</span><input id="dw-from" className="field field--sm" type="date" name="from" defaultValue={range.key === 'custom' ? range.from ?? '' : ''} /></label>
        <label className="fieldcell"><span className="label">To</span><input id="dw-to" className="field field--sm" type="date" name="to" defaultValue={range.key === 'custom' ? range.to ?? '' : ''} /></label>
        <button type="submit" className="button button--quiet">Show these dates</button>
      </form>

      {loadError && <p className="alert">{loadError}</p>}

      {data && (
        <>
          <p className="label">{range.label}</p>
          <div className="claims-summary" aria-label="Totals" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}>
            <div className="claims-tile">
              <span className="label">Total daywork hours</span>
              <strong>{hrs(data.totals.hours)}h</strong>
              <span>{data.totals.hoursNotRecorded ? `${data.totals.hoursNotRecorded} item${data.totals.hoursNotRecorded === 1 ? '' : 's'} with no hours recorded` : 'hours recorded on every item'}</span>
            </div>
            <div className="claims-tile">
              <span className="label">Works completed</span>
              <strong>{data.totals.items}</strong>
              <span>over {data.totals.days} day{data.totals.days === 1 ? '' : 's'}</span>
            </div>
            <div className={`claims-tile${data.totals.toChase > 0 ? ' claims-tile--amber' : ''}`}>
              <span className="label">Dockets</span>
              <strong>{data.totals.docketed}</strong>
              <span>{data.totals.toChase ? `${data.totals.toChase} to chase` : 'all docketed'}</span>
            </div>
            <div className={`claims-tile${approval.awaiting > 0 ? ' claims-tile--amber' : ''}`}>
              <span className="label">Approved by {clientName}</span>
              <strong>{hrs(approval.approvedHours)}h</strong>
              <span>{approval.awaiting > 0 ? `${hrs(approval.awaitingHours)}h on ${approval.awaiting} item${approval.awaiting === 1 ? '' : 's'} waiting for a signature` : approval.state === 'nothing' ? 'nothing to approve' : 'every item signed for'}</span>
            </div>
          </div>

          {data.pendingCorrectionDays > 0 && (
            <p className="alert">
              {data.pendingCorrectionDays} day{data.pendingCorrectionDays === 1 ? '' : 's'} in this period {data.pendingCorrectionDays === 1 ? 'has a correction' : 'have corrections'} written but not signed.
              The rows below are the signed record, so {data.pendingCorrectionDays === 1 ? 'that day still reads' : 'those days still read'} the old way.
              Sign {data.pendingCorrectionDays === 1 ? 'it' : 'them'} before you send the sheet, or {clientName} will be signing off work you have already moved.
            </p>
          )}

          <div className="claims-actions">
            <a className="button" href={`${pdfHref}&signoff=1`} target="_blank" rel="noopener">Sign-off sheet for the client (PDF)</a>
            <a className="button button--quiet" href={pdfHref} target="_blank" rel="noopener">Schedule only (PDF)</a>
            {showMoney && <a className="button button--quiet" href={`${pdfHref}&costed=1`} target="_blank" rel="noopener">Costed schedule (PDF)</a>}
            <Link className="button button--quiet" href={`/claims?project=${p}`}>Claims register</Link>
          </div>
          <SignoffBlock
            projectId={p}
            period={{ from: range.from ?? null, to: range.to ?? null }}
            periodLabel={range.label}
            summary={{ state: approval.state, approved: approval.approved, approvedHours: approval.approvedHours, awaiting: approval.awaiting, awaitingHours: approval.awaitingHours, awaitingNoHours: approval.awaitingNoHours }}
            awaiting={snapshotLines(lines.filter((_, i) => !approval.by[i]))}
            allLines={snapshotLines(lines)}
            hoursNotRecorded={data.totals.hoursNotRecorded}
            signoffs={signoffs}
            canRecord={canManageRegisters(current.role) && !data.truncated}
            clientName={clientName}
            pendingCorrectionDays={data.pendingCorrectionDays}
          />

          <p className="caption">A daywork is approved once {clientName} has signed for it, here on the screen or on the sign-off sheet. The sheet itemises every daywork with its labour, plant, materials, docket and photographs. A signature acknowledges what was expended, not rates or value.</p>

          <MoneyLock state={money} next={`/dayworks?project=${p}${range.key === 'all' ? '' : `&range=${range.key}`}`} compact />
          {costingError && <p className="alert">{costingError}</p>}
          {costing && showMoney && (
            <>
              <div className="dw-money">
                <span className="dw-money__fact"><span className="label">Amount, ex GST</span><strong className="mono">{costing.totals.costed ? fmtMoney(costing.totals.amount) : '—'}</strong><span className="caption">{costing.totals.costed} of {data.totals.items} item{data.totals.items === 1 ? '' : 's'} costed{costing.totals.notCosted ? ` · ${costing.totals.notCosted} without an amount` : ''}{costing.totals.plantNotCosted ? ` · ${costing.totals.plantNotCosted} with plant not costed` : ''}</span></span>
                <span className="caption dw-money__how">Each person's hours on the item at the company's rate for their name, and each machine's hours at the rate card's rate, added up. An item is costed only when every person and machine on it has hours and a rate; the rest are flagged, never guessed. Where the day named nobody, "Pick people" on the item names them; "Pick plant" names the machines.</span>
              </div>
              <RatesBlock orgId={current.project.org.id} people={costing.people} rates={costing.rates} machines={costing.machines} plantRates={costing.plantRates} canWrite={current.role === 'admin'} />
            </>
          )}
          {costing && !showMoney && (
            <p className="caption">Where a day named nobody on a daywork, “Pick people” on the item names them with their hours, and “Pick plant” names the machines — kept beside the signed day for costing; the day itself never changes.</p>
          )}

          {data.truncated && (
            <p className="alert">More than 1,000 dayworks in this period — only the first 1,000 are shown and totalled. Choose a shorter period.</p>
          )}
          {data.unsignedItems > 0 && (
            <p className="notice">{data.unsignedItems} more daywork{data.unsignedItems === 1 ? ' is' : 's are'} on {data.unsignedDays} day{data.unsignedDays === 1 ? '' : 's'} not yet signed. They join the schedule once the day is signed.</p>
          )}

          {data.weeks.length === 0 ? (
            <p className="claims-nil">No dayworks on signed days in this period.</p>
          ) : (
            <div className="claims-tablewrap">
              <table className="claims-table">
                <thead>
                  <tr><th>Date</th><th>Works completed</th><th className="n">Hours</th>{showMoney && <th className="n">Amount</th>}{!showMoney && <><th>Approved</th><th>Docket</th></>}<th>Labour</th><th>Plant</th><th>Materials</th></tr>
                </thead>
                <tbody>
                  {data.weeks.map((w, wi) => [
                    <tr key={`wk-${w.start}`} className="dw-week">
                      <td colSpan={2}><strong>Week {fmtDate(w.start)} to {fmtDate(w.end)}</strong></td>
                      <td className="n mono"><strong>{hrs(w.hours)}</strong>{w.hoursNotRecorded ? <span className="claims-flag"> +{w.hoursNotRecorded} not recorded</span> : null}</td>
                      {showMoney && <td className="n mono"><strong>{weekCost(wi)?.costed ? fmtMoney(weekCost(wi)!.amount) : '—'}</strong>{weekCost(wi)?.notCosted ? <span className="claims-flag"> +{weekCost(wi)!.notCosted} not costed</span> : null}</td>}
                      <td colSpan={showMoney ? 3 : 5} />
                    </tr>,
                    ...w.lines.map((l, i) => (
                      <DayworksRow
                        key={`${w.start}-${i}`}
                        projectId={p}
                        date={l.date}
                        entryId={l.entryId}
                        dayworkId={l.dayworkId}
                        works={l.works}
                        hours={l.hours}
                        docket={l.docket}
                        docketAddedOn={l.docketAddedOn}
                        labour={l.labour}
                        plant={l.plant}
                        materials={l.materials}
                        approved={approvedBy.get(l) ? { signedOn: approvedBy.get(l)!.signed_on, name: approvedBy.get(l)!.signed_by_name } : null}
                        cost={costOf.get(l) ?? null}
                        money={showMoney}
                        allocation={l.dayworkId && costing?.allocations[l.dayworkId] ? { labour: costing.allocations[l.dayworkId].labour, plant: costing.allocations[l.dayworkId].plant, note: costing.allocations[l.dayworkId].note, excluded: costing.allocations[l.dayworkId].excluded, excludedReason: costing.allocations[l.dayworkId].excludedReason } : null}
                        canAllocate={keeper && !data.truncated}
                        people={people}
                        machines={machines}
                      />
                    )),
                  ])}
                  <tr className="dw-total">
                    <td colSpan={2}><strong>Total: {data.totals.items} item{data.totals.items === 1 ? '' : 's'} of work over {data.totals.days} day{data.totals.days === 1 ? '' : 's'}</strong></td>
                    <td className="n mono"><strong>{hrs(data.totals.hours)}</strong></td>
                    {showMoney && costing && <td className="n mono"><strong>{costing.totals.costed ? fmtMoney(costing.totals.amount) : '—'}</strong>{costing.totals.notCosted ? <span className="claims-flag"> +{costing.totals.notCosted} not costed</span> : null}{costing.totals.excluded ? <span className="vr-note">{costing.totals.excluded} left out of the claim</span> : null}</td>}
                    <td colSpan={showMoney ? 3 : 5} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
