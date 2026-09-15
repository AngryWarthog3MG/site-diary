import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { KIND_LABEL, readItems, findings, actionOverdue, type InspectionKind } from '@/lib/inspections/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inspections · KBS Daily Diary' };

interface Row {
  id: string; template_name: string; kind: InspectionKind; inspection_date: string; area: string | null; inspector_name: string;
  items: unknown; completed_at: string | null;
  inspection_actions: Array<{ due_on: string | null; done_at: string | null }>;
}

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'inspections')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase
    .from('inspections')
    .select('id, template_name, kind, inspection_date, area, inspector_name, items, completed_at, inspection_actions(due_on, done_at)')
    .eq('project_id', current.project_id)
    .order('inspection_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];
  const today = perthToday();
  const q = `?project=${current.project_id}`;
  const openActions = rows.reduce((n, r) => n + r.inspection_actions.filter((a) => a.done_at == null).length, 0);
  const overdue = rows.reduce((n, r) => n + r.inspection_actions.filter((a) => actionOverdue(a, today)).length, 0);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Inspections</h1>
      <p className="page-subtitle">
        A checklist walked on the phone: each item OK, an issue, or not applicable, with a note and photos on
        an issue. The signature freezes it; issues become corrective actions.
      </p>
      {canRunTalks(current.role) && (
        <div className="photo-add-pair">
          <Link className="button" href={`/inspections/new${q}`}>Start an inspection</Link>
          {canAuthorEntries(current.role) && <Link className="button button--quiet" href={`/inspections/templates${q}`}>Templates</Link>}
        </div>
      )}
      <OutboxStatus />
      <section className="entries-summary" aria-label="Summary" style={{ marginTop: '1rem' }}>
        <div><p className="label">Done</p><p className="entries-summary__value mono">{rows.filter((r) => r.completed_at).length}</p></div>
        <div><p className="label">Actions open</p><p className="entries-summary__value mono">{openActions}</p></div>
        <div><p className="label">Overdue</p><p className={`entries-summary__value mono${overdue > 0 ? ' vr-missing' : ''}`}>{overdue}</p></div>
      </section>
      <hr className="rule" />
      {rows.length === 0 ? <p className="nil">No inspections yet.</p> : rows.map((r) => {
        const issues = findings(readItems(r.items)).length;
        const late = r.inspection_actions.filter((a) => actionOverdue(a, today)).length;
        return (
          <Link key={r.id} href={`/inspections/${r.id}`} className={`prestart-row ${!r.completed_at ? 'prestart-row--open' : late > 0 ? 'prestart-row--open' : issues === 0 ? 'prestart-row--done' : ''}`}>
            <span>
              <strong>{r.template_name}</strong> · {KIND_LABEL[r.kind]}
              <br />
              <span className="caption">{fmtDate(r.inspection_date)}{r.area ? ` · ${r.area}` : ''} · {r.inspector_name}</span>
              <br />
              <span className="caption">{!r.completed_at ? 'Not signed' : issues === 0 ? 'No issues' : `${issues} issue${issues === 1 ? '' : 's'}`}{late > 0 ? ` · ${late} action${late === 1 ? '' : 's'} overdue` : ''}</span>
            </span>
            <span>Open</span>
          </Link>
        );
      })}
    </main>
  );
}
