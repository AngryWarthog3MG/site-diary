import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { HomeFoot } from '@/components/home-foot';
import { Fold } from '@/components/fold';
import { PhotoZoom } from '@/components/photo-zoom';
import { fmtDate } from '@/lib/pdf/dates';
import { loadPhotoLibrary, signPhotoUrls } from '@/lib/photos/library-load';
import { groupByDay, groupByMonth, monthLabel, type LibraryDay } from '@/lib/photos/library';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Photographs · Kooboolong IMS' };

/**
 * The job's photographs, all of them, by day (README R173). Every photograph the diary holds — the
 * day's own, the ones on dayworks, variations, instructions and concrete dockets — and the crew's
 * progress photographs, in one place, newest day first, each month downloadable as a folder of dated
 * folders. Part of the Daily Diary, not a section of its own: it lists the record's files and never
 * keeps a copy.
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

  const dayBlock = (day: LibraryDay) => (
    <section key={day.date} className="photolib-day" aria-label={`Photographs of ${fmtDate(day.date)}`}>
      <header className="photolib-day__head">
        <h3>{fmtDate(day.date)}</h3>
        <p className="photolib-day__meta mono">
          {day.day === 'signed' ? `${day.entryNo ?? 'Signed'} · signed` : day.day === 'draft' ? 'Draft, not yet signed' : 'No diary for this day'} · {day.photos.length} photo{day.photos.length === 1 ? '' : 's'}
        </p>
      </header>
      <div className="photolib-grid photo-zoom-gallery">
        {day.photos.map((p) => (
          <figure key={p.path} className="photolib-item">
            {urls[p.path] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[p.path]} alt={p.caption ?? p.context} loading="lazy" />
            ) : (
              <div className="photolib-item__missing">File not found</div>
            )}
            <figcaption>
              <span className="photolib-item__context">{p.context}{p.source === 'crew' ? ` · ${p.by ?? 'crew'}, not yet on the day` : p.day === 'signed' ? '' : ' · draft'}</span>
              {p.caption && <span className="photolib-item__caption">{p.caption}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );

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
        instructions and concrete dockets, and the crew’s progress photographs. Download a month as a folder of dated
        folders, each file named by its day.
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
          {months.map((m, i) => (
            <section key={m.month} className="photolib-month">
              <header className="photolib-month__head">
                <h2>{monthLabel(m.month)}</h2>
                <a className="button button--quiet" href={`/api/entries/photos/zip?${q}&month=${m.month}`} download>Download {monthLabel(m.month)} · {m.count}</a>
              </header>
              {i === 0 ? m.days.map(dayBlock) : (
                <Fold label={`${m.days.length} day${m.days.length === 1 ? '' : 's'}`} count={m.count}>
                  {m.days.map(dayBlock)}
                </Fold>
              )}
            </section>
          ))}
        </>
      )}
    </main>
    </PhotoZoom>
  );
}
