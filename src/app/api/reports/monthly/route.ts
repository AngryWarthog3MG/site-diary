import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadMonthEntries, MonthlyLoadError, type MonthData } from '@/lib/monthly/bundle';
import { renderMonthlyBundle } from '@/lib/monthly/render';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos } from '@/lib/pdf/photos';
import { renderDailyPdf, BrowserUnavailableError } from '@/lib/pdf/render';

// Potentially a whole month of dockets; most are reused from storage, but a
// backlog of never-exported entries can mean many renders in one request.
export const maxDuration = 300;
export const runtime = 'nodejs';

const EXPORTS_BUCKET = 'exports';
const LINK_TTL_SECONDS = 60 * 60;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The monthly bundle (one PDF: cover index + every signed docket in the
 * month). Reads run under the caller's RLS; each daily docket is reused from
 * the exports bucket where it already exists — a signed entry's PDF is
 * byte-identical on every render, so the stored copy IS the render — and
 * generated and stored where it does not.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const month = url.searchParams.get('month');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!month || !MONTH_RE.test(month)) {
    return fail('bad_request', 'month must be YYYY-MM.', 400);
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  let entries;
  try {
    entries = await loadMonthEntries(supabase, project.id, month);
  } catch (error) {
    if (error instanceof MonthlyLoadError) return fail('bad_request', error.message, 400);
    throw error;
  }
  if (entries.length === 0) {
    return fail('not_found', 'No signed entries in that month — nothing to bundle.', 404);
  }

  const { monthRange } = await import('@/lib/monthly/bundle');
  const { start, end } = monthRange(month);
  const data: MonthData = {
    project: { id: project.id, name: project.name, code: project.code, orgCode },
    month,
    start,
    end,
    entries,
  };

  const admin = createAdminClient();
  const dailyPdfs: Uint8Array[] = [];
  try {
    for (const entry of entries) {
      const fileName = `${entry.entry_no}.pdf`;
      const dailyPath = `${project.id}/${fileName}`;
      const existing = await admin.storage.from(EXPORTS_BUCKET).download(dailyPath);
      if (existing.data) {
        dailyPdfs.push(new Uint8Array(await existing.data.arrayBuffer()));
        continue;
      }

      // A failed download is not proof the export is absent — a transient
      // Storage error looks identical here. The stored daily PDF of a signed
      // entry is the record, so this path must never overwrite one it merely
      // failed to read. Establish absence before rendering anything.
      const listing = await admin.storage
        .from(EXPORTS_BUCKET)
        .list(project.id, { search: fileName, limit: 100 });
      if (listing.error) {
        return fail(
          'server_error',
          `Could not confirm whether ${entry.entry_no} is already exported: ${listing.error.message}`,
          503,
        );
      }
      if (listing.data?.some((object) => object.name === fileName)) {
        return fail(
          'server_error',
          `The stored daily PDF for ${entry.entry_no} exists but could not be read. ` +
            'Retry in a moment — it will not be regenerated over the top of the record.',
          503,
        );
      }

      const docket = await loadDocketEntry(supabase, entry.id);
      if (!docket) return fail('not_found', `Entry ${entry.entry_no} could not be loaded.`, 404);
      const pdf = await renderDailyPdf({ entry: docket, photos: await collectPhotos(supabase, docket) });
      // upsert:false so a race with another export cannot replace the record.
      const { error: storeError } = await admin.storage
        .from(EXPORTS_BUCKET)
        .upload(dailyPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
      if (storeError) {
        return fail(
          'server_error',
          `Could not store the daily PDF for ${entry.entry_no}: ${storeError.message}`,
          500,
        );
      }
      dailyPdfs.push(pdf);
    }
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'Docket rendering failed.';
    return fail('server_error', `Could not prepare the daily dockets: ${message}`, 500);
  }

  let bundle: Uint8Array;
  try {
    bundle = await renderMonthlyBundle(data, dailyPdfs);
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'Bundling failed.';
    return fail('server_error', `Could not build the monthly bundle: ${message}`, 500);
  }

  const objectPath = `${project.id}/monthly/${month}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(objectPath, Buffer.from(bundle), { contentType: 'application/pdf', upsert: true });
  if (uploadError) {
    return fail('server_error', `Could not store the bundle: ${uploadError.message}`, 500);
  }

  const { data: link, error: linkError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);
  if (linkError || !link) {
    return fail('server_error', 'The bundle was stored but no link could be made.', 500);
  }

  return ok({
    url: link.signedUrl,
    path: objectPath,
    entries: entries.length,
    bytes: bundle.length,
  });
}
