import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { loadTemplates } from '@/lib/forms/load';
import { Designer } from './designer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Form designer · Kooboolong IMS' };

/** The office writes and issues the company's forms here (README R180). Company scope: the same list on every job. */
export default async function DesignPage({ searchParams }: { searchParams: Promise<{ project?: string; t?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project, t } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  guardScreen(current, 'forms_design');
  const supabase = await createClient();
  const templates = await loadTemplates(supabase, current.project.org.id);
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Form designer</h1>
      <p className="page-subtitle">
        Write a checklist once: sections, questions, what counts as a fail, which fails raise an action, where a photograph is needed,
        who fills it. Issue it and it is frozen — a change is a new revision, and a form already filled keeps the wording it was filled on.
      </p>
      <Designer orgId={current.project.org.id} userId={userId} templates={templates} selectedId={t ?? null} projectId={current.project_id} />
    </main>
  );
}
