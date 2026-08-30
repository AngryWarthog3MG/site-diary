import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { loadDocketEntry } from '@/lib/pdf/load';
import { DailyDocket, type PhotoImage } from '@/lib/pdf/docket';
import { DOCKET_CSS } from '@/lib/pdf/styles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Docket · Site Diary' };

/**
 * The docket on screen.
 *
 * The same `DailyDocket` component and the same stylesheet the PDF is rendered
 * from — §2 is explicit that the printed template must be the one used on
 * screen, and the surest way to guarantee that is for there to be only one.
 *
 * Photos are signed URLs here rather than embedded data, because a browser can
 * fetch them and a PDF sitting in someone's downloads folder in a year cannot.
 */
export default async function DocketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const supabase = await createClient();

  const entry = await loadDocketEntry(supabase, id);
  if (!entry) notFound();

  const photos: PhotoImage[] = [];
  const paths: Array<{ path: string; context: string; caption: string | null }> = [];

  entry.variations.forEach((variation, index) => {
    for (const path of (variation.photo_urls as string[] | null) ?? []) {
      paths.push({
        path,
        context: `Variation ${(variation.vr_ref as string | null) ?? index + 1}`,
        caption: null,
      });
    }
  });
  for (const photo of entry.photos) {
    paths.push({
      path: photo.url as string,
      context: 'Site photograph',
      caption: (photo.caption as string | null) ?? null,
    });
  }

  for (const item of paths) {
    const { data } = await supabase.storage.from('entry-photos').createSignedUrl(item.path, 3600);
    if (data?.signedUrl) {
      photos.push({ src: data.signedUrl, caption: item.caption, context: item.context });
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DOCKET_CSS }} />
      <DailyDocket entry={entry} photos={photos} />
    </>
  );
}
