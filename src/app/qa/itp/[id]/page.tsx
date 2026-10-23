import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { loadQaInstance } from '@/lib/qa/load';
import { STATE_LABEL } from '@/lib/qa/model';
import { ItpStatusActions } from '../../qa-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inspection and test plan · Kooboolong IMS' };

type Spec = {
  project_info?: Array<{ key: string; label: string; value: string }>;
  reference_docs?: { specifications?: { heading: string; columns: string[]; rows: string[][] }; standards?: { heading: string; columns: string[]; rows: string[][] }; associated_itrs?: { heading: string; columns: string[]; rows: string[][] } };
  inspection_legend?: string;
  parties?: string[];
  activities?: Array<{ no: string; group?: string; activity: string; governing: string[]; criteria: string[]; record: string[]; inspection: Record<string, string> }>;
  acceptance?: { heading: string; parties: string[] };
  closing?: string;
};

/**
 * One inspection and test plan on the job (README R164): the plan as the head contractor sees it — project
 * information, reference documents, the activities with their H / W / R marks — where it stands, and the records
 * against its ITRs. The wording is the template's, which is contractual; nothing here paraphrases it.
 */
export default async function QaItpPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  const supabase = await createClient();
  const { data: inst } = await supabase.from('qa_itp_instances').select('id, project_id').eq('id', id).maybeSingle();
  if (!inst) notFound();
  const current = resolveProject(memberships, (inst.project_id as string) ?? project);
  if (!current) redirect('/');
  if (!sees(current, 'qa')) redirect(`/?project=${current.project_id}`);
  guardScreen(current, 'qa');
  const block = await loadQaInstance(supabase, current.project_id, id, current.project.org.id);
  if (!block) notFound();
  const { data: job } = await supabase.from('projects').select('principal_contractor').eq('id', current.project_id).maybeSingle();
  const hc = ((job?.principal_contractor as string | null) ?? '').trim() || null;
  const spec = block.template.spec as unknown as Spec;
  const parties = spec.parties ?? [];
  const office = current.role === 'admin' || current.role === 'pm';
  const q = `?project=${current.project_id}`;
  const groups: Array<{ group: string | null; rows: NonNullable<Spec['activities']> }> = [];
  for (const a of spec.activities ?? []) {
    const g = a.group ?? null;
    const last = groups[groups.length - 1];
    if (!last || last.group !== g) groups.push({ group: g, rows: [a] }); else last.rows.push(a);
  }

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{block.template.title}</h1>
      <p className="page-subtitle mono">{block.template.code} · Rev {block.template.revision} · Inspection and test plan</p>

      <div className="qa-itp__status">
        <p className="label">On this job</p>
        <p>
          <strong>{block.instance.status === 'draft' ? 'Draft' : block.instance.status === 'issued' ? `Issued to ${block.instance.issued_to ?? hc ?? 'the head contractor'}` : block.instance.status === 'approved' ? `Approved by ${block.instance.approved_by_name}` : 'Signed off'}</strong>
          {block.instance.issued_at ? <span className="caption"> · issued {fmtPerthDate(block.instance.issued_at)}</span> : null}
          {block.instance.approved_at ? <span className="caption"> · approved {fmtPerthDate(block.instance.approved_at)}</span> : null}
          {block.instance.signed_at ? <span className="caption"> · signed {fmtPerthDate(block.instance.signed_at)}</span> : null}
        </p>
        {office && <ItpStatusActions instanceId={block.instance.id} status={block.instance.status} headContractor={hc} />}
      </div>

      {spec.project_info && (
        <dl className="qa-info">
          {spec.project_info.filter((f) => f.value).map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        </dl>
      )}

      {spec.reference_docs && (
        <details className="qa-refs">
          <summary>Reference documentation</summary>
          {[spec.reference_docs.specifications, spec.reference_docs.standards, spec.reference_docs.associated_itrs].filter(Boolean).map((r) => (
            <div key={r!.heading} className="claims-tablewrap">
              <p className="label">{r!.heading}</p>
              <table className="claims-table"><thead><tr>{r!.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{r!.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
            </div>
          ))}
        </details>
      )}

      {spec.inspection_legend && <p className="caption qa-legend">{spec.inspection_legend}</p>}
      <div className="claims-tablewrap">
        <table className="claims-table qa-activities">
          <thead><tr><th>No.</th><th>Description of required activity</th><th>Governing specification or standard</th><th>Acceptance criteria</th><th>Record of compliance / completion</th>{parties.map((p) => <th key={p} className="c">{p}</th>)}</tr></thead>
          <tbody>
            {groups.map((g, gi) => [
              g.group ? <tr key={`g-${gi}`} className="dw-week"><td colSpan={5 + parties.length}><strong>{g.group}</strong></td></tr> : null,
              ...g.rows.map((a) => (
                <tr key={a.no} className={Object.values(a.inspection).some((m) => /H/.test(m)) ? 'qa-activity--hold' : undefined}>
                  <td className="mono">{a.no}</td>
                  <td><strong>{a.activity}</strong></td>
                  <td>{a.governing.map((x, i) => <span key={i} className="qa-line">{x}</span>)}</td>
                  <td>{a.criteria.map((x, i) => <span key={i} className="qa-line">{x}</span>)}</td>
                  <td>{a.record.map((x, i) => <span key={i} className="qa-line">{x}</span>)}</td>
                  {parties.map((p) => <td key={p} className="c mono">{a.inspection[p] || '—'}</td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>

      <h2 className="home-card__title" style={{ marginTop: '1.25rem' }}>Records against this plan</h2>
      {block.forms.map((f) => (
        <div key={f.template.id} className="qa-form">
          <div className="qa-form__head">
            <div><p className="label">{f.template.code} · Rev {f.template.revision}</p><h3 className="qa-form__title">{f.template.title}</h3></div>
            {current.role !== 'labourer' && block.instance.status !== 'draft' && <Link className="button qa-form__new" href={`/qa/record/new${q}&template=${f.template.id}&itp=${block.instance.id}`}>New</Link>}
          </div>
          {f.records.length === 0 ? <p className="caption">Nothing recorded yet.</p> : (
            <ul className="qa-records">
              {f.records.map(({ row, state }) => (
                <li key={row.id} className={`qa-record qa-record--${state}`}>
                  <Link className="qa-record__main" href={`/qa/record/${row.id}${q}`}><span className="qa-record__lot">{row.lot_or_element ?? 'No lot named'}</span><span className="caption">{row.gap_count ? `${row.gap_count} gaps · ` : ''}updated {fmtPerthDate(row.updated_at)}</span></Link>
                  <span className={`pe-badge pe-badge--${state === 'released' || state === 'complete' ? 'ok' : state === 'voided' ? 'mute' : state === 'gaps_open' ? 'bad' : 'warn'}`}>{STATE_LABEL[state]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <Link className="button button--quiet" href={`/qa${q}`}>All ITPs &amp; ITRs</Link>
    </main>
  );
}
