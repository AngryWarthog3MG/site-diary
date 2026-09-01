import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadMonthEntries, monthRange, type MonthData } from './bundle';
import { renderMonthlyBundle } from './render';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos } from '@/lib/pdf/photos';
import { renderDailyPdf } from '@/lib/pdf/render';

/**
 * One monthly bundle, generated and stored — shared by the on-demand route
 * and the first-of-month distribution. Reuses each stored daily export and
 * refuses to regenerate over one it merely failed to read.
 */
export async function generateMonthlyBundle(
  supabase: SupabaseClient,
  project: { id: string; name: string; code: string; orgCode: string },
  month: string,
): Promise<{ data: MonthData; pdf: Uint8Array; objectPath: string } | { empty: true }> {
  const entries = await loadMonthEntries(supabase, project.id, month);
  if (entries.length === 0) return { empty: true };
  const { start, end } = monthRange(month);
  const data: MonthData = { project, month, start, end, entries };

  const admin = createAdminClient();
  const listing = await admin.storage.from('exports').list(project.id, { limit: 1000 });
  if (listing.error) throw new Error(`Could not list exports: ${listing.error.message}`);
  const stored = new Set((listing.data ?? []).map((object) => object.name));

  const dailyPdfs: Uint8Array[] = [];
  for (const entry of entries) {
    const fileName = `${entry.entry_no}.pdf`;
    const path = `${project.id}/${fileName}`;
    if (stored.has(fileName)) {
      const existing = await admin.storage.from('exports').download(path);
      if (!existing.data) {
        throw new Error(`Stored export for ${entry.entry_no} exists but could not be read; retry.`);
      }
      dailyPdfs.push(new Uint8Array(await existing.data.arrayBuffer()));
      continue;
    }
    const docket = await loadDocketEntry(supabase, entry.id);
    if (!docket) throw new Error(`Entry ${entry.entry_no} could not be loaded.`);
    const pdf = await renderDailyPdf({ entry: docket, photos: await collectPhotos(supabase, docket) });
    await admin.storage
      .from('exports')
      .upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
    dailyPdfs.push(pdf);
  }

  const bundle = await renderMonthlyBundle(data, dailyPdfs);
  const objectPath = `${project.id}/monthly/${month}.pdf`;
  const { error: uploadError } = await admin.storage
    .from('exports')
    .upload(objectPath, Buffer.from(bundle), { contentType: 'application/pdf', upsert: true });
  if (uploadError) throw new Error(`Could not store the bundle: ${uploadError.message}`);

  return { data, pdf: bundle, objectPath };
}
