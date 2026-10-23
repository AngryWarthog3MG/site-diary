import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadQaRecord } from '@/lib/qa/load';
import { RecordEditor } from './record-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inspection and test record · Kooboolong IMS' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One inspection and test record (README R164): the form filled in for one lot, pour or element. `/qa/record/new`
 * chooses the id here and sends the phone to it, so the record exists on the phone before it exists in the database
 * and is upserted later exactly once. An existing record opens as it stands; a signed one opens read-only.
 */
export default async function QaRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string; template?: string; itp?: string }> }) {
  const { memberships, profile, email } = await requireUser();
  const { id } = await params;
  const { project, template, itp } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!sees(current, 'qa')) redirect(`/?project=${current.project_id}`);
  guardScreen(current, 'qa');
  const q = `?project=${current.project_id}`;
  if (id === 'new') {
    if (!template || !UUID_RE.test(template)) redirect(`/qa${q}`);
    redirect(`/qa/record/${crypto.randomUUID()}${q}&template=${template}${itp && UUID_RE.test(itp) ? `&itp=${itp}` : ''}`);
  }
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const loaded = await loadQaRecord(supabase, current.project_id, id, template && UUID_RE.test(template) ? template : null);
  if (!loaded) notFound();
  const { record, template: t, instance } = loaded;
  const instanceId = record?.itp_instance_id ?? (itp && UUID_RE.test(itp) ? itp : null);
  // The signatures already given, as links that last the hour.
  const paths = (record?.signoffs ?? []).map((s) => s.signature_path).filter(Boolean);
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await supabase.storage.from('entry-photos').createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  // The people a sign-off may name: the job's crew list, then the staff list.
  const [{ data: crew }, { data: staff }] = await Promise.all([
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
    supabase.from('staff').select('name').eq('org_id', current.project.org.id).eq('active', true).order('name'),
  ]);
  const seen = new Set<string>(); const people: string[] = [];
  for (const r of [...((crew ?? []) as Array<{ name: string }>), ...((staff ?? []) as Array<{ name: string }>)]) { const n = String(r.name ?? '').trim(); if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); people.push(n); } }

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{t.title}</h1>
      <p className="page-subtitle mono">{t.code} · Rev {t.revision}{instance ? ` · under ${instance.status === 'draft' ? 'a draft ITP' : 'the ITP'}` : ''}</p>
      <RecordEditor
        projectId={current.project_id}
        recordId={id}
        template={t}
        record={record}
        instanceId={instanceId}
        canWrite={current.role !== 'labourer'}
        myName={profile?.full_name ?? email ?? ''}
        today={perthToday()}
        signatureUrls={urls}
        people={people}
        backTo={`/qa${q}`}
      />
    </main>
  );
}
