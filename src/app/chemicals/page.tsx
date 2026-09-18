import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { loadChemicals } from '@/lib/chemicals/load';
import { SDS_STATUS_LABEL, hazardLabel, sdsNeedsAttention } from '@/lib/chemicals/model';
import { ChemicalsScreen } from './chemicals-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chemicals · Kooboolong IMS' };

/**
 * The hazardous chemicals register for this workplace: what is here, where it
 * is kept, and whether the register holds a current safety data sheet for each.
 *
 * Every role reads this one, labourers included — reg. 346(3) requires the
 * register be readily accessible to the workers involved in using, handling or
 * storing the chemical. The page prints, which is the backup WorkSafe WA asks
 * for when the power or the network is out.
 */
export default async function ChemicalsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'chemicals')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const today = perthToday();
  const data = await loadChemicals(supabase, current.project_id, current.project.org.id, today);
  const q = `?project=${current.project_id}`;
  const canKeepList = canAuthorEntries(current.role);
  const canPutOnSite = canRunTalks(current.role);

  return (
    <main className="sheet chemreg">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Chemicals on site</h1>
      <p className="page-subtitle">
        {canPutOnSite
          ? 'Everything hazardous used, handled or stored here, and the safety data sheet for each. Keep it current and keep it where the crew can reach it — that is what the law asks of this page. Print it for the smoko hut so it is still readable when the network is not.'
          : 'Everything hazardous on this site, and its safety data sheet. Tap a chemical to read how to use it safely, what to wear, and what to do if it spills or gets on you.'}
      </p>

      <div className="chemreg__stats">
        <span><strong className="mono">{data.summary.total}</strong> on this site</span>
        <span className={data.summary.missing > 0 ? 'vr-missing' : undefined}><strong className="mono">{data.summary.missing}</strong> with no sheet</span>
        <span className={data.summary.outOfDate > 0 ? 'vr-missing' : undefined}><strong className="mono">{data.summary.outOfDate}</strong> out of date</span>
        <span><strong className="mono">{data.summary.due}</strong> due for review</span>
      </div>

      <p className="chemreg__asof caption">Register as at {fmtDate(today)} · {current.project.org.name} · {current.project.name}</p>

      {data.register.length === 0 ? (
        <p className="nil">
          {canPutOnSite
            ? 'Nothing recorded on this site yet. Add the diesel, the degreaser, the weedkiller, the two-stroke — anything with a hazard on the label.'
            : 'Nothing recorded on this site yet. If you are using fuel, degreaser, weedkiller or anything with a hazard on the label, ask your supervisor to add it and its safety data sheet.'}
        </p>
      ) : (
        <div className="chemreg__list">
          {data.register.map((line) => (
            <Link key={line.productId} href={`/chemicals/${line.productId}${q}`} className={`prestart-row ${sdsNeedsAttention(line.status) ? 'prestart-row--open' : 'prestart-row--done'}`}>
              <span>
                <strong>{line.name}</strong>
                {line.manufacturer ? ` · ${line.manufacturer}` : ''}
                {line.dgClass ? ` · DG class ${line.dgClass}` : ''}
                <br />
                <span className={`caption${sdsNeedsAttention(line.status) ? ' vr-missing' : ''}`}>
                  {SDS_STATUS_LABEL[line.status]}
                  {line.reviewDue ? ` · review by ${fmtDate(line.reviewDue)}` : ''}
                </span>
                {(line.location || line.quantity) && (
                  <><br /><span className="caption">{[line.location, line.quantity].filter(Boolean).join(' · ')}</span></>
                )}
                {line.hazardClasses.length > 0 && (
                  <><br /><span className="caption">{line.hazardClasses.map(hazardLabel).join(' · ')}</span></>
                )}
              </span>
              <span className="chemreg__open">Open</span>
            </Link>
          ))}
        </div>
      )}

      <ChemicalsScreen
        projectId={current.project_id}
        orgId={current.project.org.id}
        userId={userId}
        canKeepList={canKeepList}
        canPutOnSite={canPutOnSite}
        products={data.products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, onJob: data.onJob.has(p.id) }))}
      />

      <hr className="rule" />
      <p className="caption">
        Kept under the Work Health and Safety (General) Regulations 2022 (WA) reg. 346. A sheet is reviewed at
        least every five years, so one older than that is not current and the register says so.
      </p>
    </main>
  );
}
