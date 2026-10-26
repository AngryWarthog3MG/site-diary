import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { ProgressPhotos, type DayPhotoView } from './progress-photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progress photos · Kooboolong IMS' };

/**
 * The crew's door for the day's photographs (README R172): take or pick photos and they are on the job for today,
 * beside the diary — the supervisor's review screen picks each up once and it becomes a photograph of the day,
 * confirmed at signing like everything else. A leading hand gets here without the diary; nothing here is the record.
 */
export default async function PhotosPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'photos');
  const supabase = await createClient();
  const today = perthToday();
  const [{ data: rows }, { data: days }] = await Promise.all([
    supabase.from('day_photos').select('id, url, caption, taken_at, added_by, created_at').eq('project_id', current.project_id).eq('taken_on', today).order('created_at'),
    supabase.from('entries').select('id, status').eq('project_id', current.project_id).eq('entry_date', today),
  ]);
  const list = (rows ?? []) as Array<{ id: string; url: string; caption: string | null; taken_at: string | null; added_by: string; created_at: string }>;
  // Who took each: the name on the sheets, never an email (README R70).
  const names = new Map<string, string | null>();
  if (list.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(list.map((r) => r.added_by))]);
    for (const pr of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(pr.id, pr.full_name);
  }
  const urls: Record<string, string> = {};
  if (list.length) {
    const { data } = await supabase.storage.from('entry-photos').createSignedUrls(list.map((r) => r.url), 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  const photos: DayPhotoView[] = list.map((r) => ({ id: r.id, url: r.url, caption: r.caption, takenAt: r.taken_at, by: names.get(r.added_by) ?? null, createdAt: r.created_at, signedUrl: urls[r.url] ?? null }));
  const dayState: 'none' | 'open' | 'signed' = (days ?? []).some((d) => d.status !== 'signed') ? 'open' : (days ?? []).length ? 'signed' : 'none';

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Progress photos</h1>
      <p className="page-subtitle">Today’s photographs of the work, from whoever is on site. The supervisor sees each one on the day’s diary and it prints on the docket when the day is signed.</p>
      <ProgressPhotos projectId={current.project_id} today={today} photos={photos} dayState={dayState} backTo={`/?project=${current.project_id}`} />
    </main>
  );
}
