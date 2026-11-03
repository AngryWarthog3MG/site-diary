import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { HomeFoot } from '@/components/home-foot';
import { PhotoZoom } from '@/components/photo-zoom';
import { loadPhotoLibrary, signPhotoUrls } from '@/lib/photos/library-load';
import { groupByDay, groupByMonth, kindsOf } from '@/lib/photos/library';
import { PhotoFinder } from './photo-finder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Photographs · Kooboolong IMS' };

/**
 * The job's photographs, all of them, by day (README R173). Every photograph the diary holds — the
 * day's own, the ones on dayworks, variations, instructions and concrete dockets — and the crew's
 * progress photographs, in one place, newest day first, each month downloadable as a folder of dated
 * folders. Its own item under Diary since README R183 (it was behind the diary's hero), with a finder over the lot;
 * it lists the record's files and never keeps a copy.
 */
export default async function PhotoLibraryPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'entries');

  const supabase = await createClient();
  const photos = await loadPhotoLibrary(supabase, current.project_id);
  const days = groupByDay(photos);
  const months = groupByMonth(days);
  const urls = await signPhotoUrls(supabase, photos.map((p) => p.path));
  const total = days.reduce((n, d) => n + d.photos.length, 0);
  const crewWaiting = photos.filter((p) => p.source === 'crew').length;
  const q = `project=${current.project_id}`;

  return (
    <PhotoZoom>
    <main className="sheet sheet--wide">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.name} · {current.project.code}</p>
      <h1 className="page-title">Photographs</h1>
      <p className="page-subtitle">
        Every photograph taken on the job, by the day it was taken: the diary’s own, the ones on dayworks, variations,
        instructions and concrete dockets, and the crew’s progress photographs. Search for the one you need, or download
        a month as a folder of dated folders, each file named by its day.
      </p>

      <nav className="photolib-actions" aria-label="Photo library actions">
        <Link className="button button--quiet" href={`/entries?${q}`}>Back to the diary</Link>
        {total > 0 && <a className="button" href={`/api/entries/photos/zip?${q}`} download>Download everything · {total}</a>}
      </nav>

      {total === 0 ? (
        <p className="review-empty">No photographs on this job yet. They arrive with the day’s diary, or from the crew’s phones.</p>
      ) : (
        <>
          <p className="review-muted">
            {total} photograph{total === 1 ? '' : 's'} over {days.length} day{days.length === 1 ? '' : 's'}
            {crewWaiting > 0 ? `, ${crewWaiting} from the crew not yet carried onto a day` : ''}. Tap one to see it big.
          </p>
          <PhotoFinder months={months} kinds={kindsOf(photos)} urls={urls} total={total} q={q} />
        </>
      )}
    </main>
    </PhotoZoom>
  );
}
