import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { readSteps, type SwmsKind } from '@/lib/swms/model';
import { UploadSwmsForm } from './upload-form';
import { SwmsForm, type SwmsFormValues } from './swms-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New SWMS · Kooboolong IMS' };

/**
 * A new method statement — blank, or started from an existing one (`from`),
 * or a revision of one in use (`revise`), which supersedes it when put into use.
 */
export default async function NewSwmsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; kind?: string; from?: string; revise?: string; mode?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { project, kind, from, revise, mode } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/swms?project=${current.project_id}`);

  const supabase = await createClient();
  const { data: crew } = await supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name');
  const { data: me } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();

  let initial: SwmsFormValues = {
    kind: kind === 'jsa' ? 'jsa' : 'swms',
    title: '', activity: '', hrcw: [], ppe: [], permits: '', plant: '', legislation: '',
    prepared_by: (me?.full_name as string | null) ?? '', reviewed_by: '',
    steps: [],
  };
  let supersedes: { id: string; title: string; version: number } | null = null;
  const source = from ?? revise;
  if (source) {
    const { data: s } = await supabase.from('swms').select('*').eq('id', source).eq('project_id', current.project_id).maybeSingle();
    if (s) {
      initial = {
        kind: s.kind as SwmsKind, title: s.title, activity: s.activity ?? '', hrcw: s.hrcw ?? [], ppe: s.ppe ?? [],
        permits: s.permits ?? '', plant: s.plant ?? '', legislation: s.legislation ?? '',
        prepared_by: initial.prepared_by, reviewed_by: '', steps: readSteps(s.steps),
      };
      if (revise && s.status === 'active') supersedes = { id: s.id, title: s.title, version: s.version };
    }
  }

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{supersedes ? `Revise: ${supersedes.title}` : mode === 'upload' ? 'File a SWMS you already have' : `New ${initial.kind === 'jsa' ? 'JSA' : 'SWMS'}`}</h1>
      {supersedes && (
        <p className="notice">
          This will be version {supersedes.version + 1}. Version {supersedes.version} stays in use, with its sign-ons,
          until this one is put into use; then it is superseded and everyone signs on again.
        </p>
      )}
      {!supersedes && (
        <nav className="chips" aria-label="How" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '0.75rem 0 1rem' }}>
          <Link href={`/swms/new?project=${current.project_id}${kind === 'jsa' ? '&kind=jsa' : ''}`} className={`chip chip--link${mode !== 'upload' ? ' chip--on' : ''}`} aria-current={mode !== 'upload' ? 'page' : undefined}>Write it here</Link>
          <Link href={`/swms/new?project=${current.project_id}&mode=upload`} className={`chip chip--link${mode === 'upload' ? ' chip--on' : ''}`} aria-current={mode === 'upload' ? 'page' : undefined}>File the one you have</Link>
        </nav>
      )}
      {mode === 'upload' && !supersedes ? (
        <UploadSwmsForm projectId={current.project_id} userId={userId} preparedBy={initial.prepared_by} />
      ) : (
        <SwmsForm projectId={current.project_id} userId={userId} initial={initial} crew={(crew ?? []).map((c) => String(c.name))} supersedesId={supersedes?.id ?? null} />
      )}
    </main>
  );
}
