import { fail, forbidUnlessSees, isUuid, requireApiUser } from '@/lib/api';
import { loadPhotoLibrary } from '@/lib/photos/library-load';
import { groupByDay, zipEntries, zipFileName } from '@/lib/photos/library';
import { zipStream, type ZipEntry } from '@/lib/zip';

// A job's photographs, several hundred downloads from Tokyo: the stream starts at once, the whole may take a while.
export const maxDuration = 300;
export const runtime = 'nodejs';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const BATCH = 6;

/**
 * GET ?project[&month=YYYY-MM] — the job's photographs as a zip of dated folders (README R173).
 *
 * Streamed, nothing compressed, nothing stored: each photograph is fetched under the caller's RLS and
 * written out as it arrives, so the response begins before the last file is in hand and no copy of the
 * record is left in a bucket. A month at a time is the usual size; the whole job is offered too.
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const month = url.searchParams.get('month');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (month != null && !MONTH_RE.test(month)) return fail('bad_request', 'month must be YYYY-MM.', 400);
  const forbidden = await forbidUnlessSees(supabase, user.id, projectId, 'entries');
  if (forbidden) return forbidden;

  const { data: project } = await supabase.from('projects').select('id, code').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);

  const range = month ? { from: `${month}-01`, to: `${month}-31` } : {};
  const photos = await loadPhotoLibrary(supabase, projectId, range);
  if (!photos.length) return fail('not_found', month ? 'No photographs in that month.' : 'No photographs on this job yet.', 404);
  const entries = zipEntries(String(project.code), groupByDay(photos));

  async function* files(): AsyncGenerator<ZipEntry> {
    for (let i = 0; i < entries.length; i += BATCH) {
      const slice = entries.slice(i, i + BATCH);
      const got = await Promise.all(slice.map(async ({ name, photo }) => {
        const { data } = await supabase.storage.from('entry-photos').download(photo.path);
        if (!data) return null;
        const [y, m, d] = photo.date.split('-').map(Number);
        return { name, bytes: new Uint8Array(await data.arrayBuffer()), mtime: { year: y, month: m, day: d, hour: 12, minute: 0, second: 0 } } satisfies ZipEntry;
      }));
      // A file the bucket no longer has is left out, not written empty — the orphan check reports it.
      for (const f of got) if (f) yield f;
    }
  }

  const fileName = zipFileName(String(project.code), month);
  return new Response(zipStream(files()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
