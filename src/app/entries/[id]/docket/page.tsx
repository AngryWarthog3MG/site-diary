import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { loadDocketEntry } from '@/lib/pdf/load';
import { DailyDocket, type PhotoImage } from '@/lib/pdf/docket';
import { collectPhotoPaths } from '@/lib/pdf/photos';
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

  // The same path-and-caption list the PDF embeds, signed for the browser —
  // the two renderings of the record must not gather photos independently.
  const photos: PhotoImage[] = [];
  for (const item of collectPhotoPaths(entry)) {
    const { data } = await supabase.storage.from(item.bucket).createSignedUrl(item.path, 3600);
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
