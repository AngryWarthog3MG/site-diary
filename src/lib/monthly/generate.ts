import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadMonthEntries, monthRange, type MonthData } from './bundle';
import { renderMonthlyBundle } from './render';
import { planVolumes, volumePath, STORAGE_LIMIT_BYTES } from './volumes';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos } from '@/lib/pdf/photos';
import { collectSignatures } from '@/lib/pdf/photos';
import { renderDailyPdf } from '@/lib/pdf/render';

export interface BundleVolume {
  part: number;
  of: number;
  objectPath: string;
  bytes: number;
  entryNos: string[];
  from: string;
  to: string;
}

const PAGE = 1000;

/** Every stored export in the project's folder, with its size — paged, so a long job is not cut off at 1,000 files. */
async function storedExports(admin: ReturnType<typeof createAdminClient>, projectId: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from('exports').list(projectId, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list exports: ${error.message}`);
    for (const object of data ?? []) {
      const size = (object.metadata as { size?: number } | null)?.size;
      if (typeof size === 'number') sizes.set(object.name, size);
    }
    if ((data ?? []).length < PAGE) return sizes;
  }
}

/**
 * The month's bundle, generated and stored — shared by the on-demand route and
 * the first-of-month distribution. Each stored daily export is reused as it is
 * (a signed entry's PDF is the record, never regenerated over); a docket never
 * exported is rendered and stored first. The month is then bound in as many
 * parts as keep each file under the storage limit (README R71), one part at a
 * time so a heavy month is never all in memory at once.
 */
export async function generateMonthlyBundle(
  supabase: SupabaseClient,
  project: { id: string; name: string; code: string; orgCode: string },
  month: string,
): Promise<{ data: MonthData; volumes: BundleVolume[] } | { empty: true }> {
  const entries = await loadMonthEntries(supabase, project.id, month);
  if (entries.length === 0) return { empty: true };
  const { start, end } = monthRange(month);
  const data: MonthData = { project, month, start, end, entries };

  const admin = createAdminClient();
  const stored = await storedExports(admin, project.id);

  // Sizes first, rendering and storing any docket that has never been exported.
  const sizes: number[] = [];
  for (const entry of entries) {
    const fileName = `${entry.entry_no}.pdf`;
    const known = stored.get(fileName);
    if (known != null) { sizes.push(known); continue; }
    const docket = await loadDocketEntry(supabase, entry.id);
    if (!docket) throw new Error(`Entry ${entry.entry_no} could not be loaded.`);
    const pdf = await renderDailyPdf({
      entry: docket,
      photos: await collectPhotos(supabase, docket),
      signatures: await collectSignatures(supabase, docket),
    });
    // upsert:false — a race with another export must never replace the record.
    const { error } = await admin.storage
      .from('exports')
      .upload(`${project.id}/${fileName}`, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) {
      throw new Error(`Could not store the daily PDF for ${entry.entry_no}: ${error.message}`);
    }
    sizes.push(pdf.length);
  }

  const plan = planVolumes(sizes);
  const partOf = new Map<string, number>();
  plan.forEach((indices, i) => { for (const index of indices) partOf.set(entries[index].id, i + 1); });

  const volumes: BundleVolume[] = [];
  for (const [i, indices] of plan.entries()) {
    const part = i + 1;
    const dailyPdfs: Uint8Array[] = [];
    for (const index of indices) {
      const entry = entries[index];
      const { data: file } = await admin.storage.from('exports').download(`${project.id}/${entry.entry_no}.pdf`);
      if (!file) throw new Error(`The stored daily PDF for ${entry.entry_no} could not be read. Try again in a moment.`);
      dailyPdfs.push(new Uint8Array(await file.arrayBuffer()));
    }
    const pdf = await renderMonthlyBundle(data, dailyPdfs, { part, of: plan.length, partOf });
    if (pdf.length > STORAGE_LIMIT_BYTES) {
      throw new Error(`Part ${part} of the bundle is ${Math.round(pdf.length / 1048576)} MB, over the ${STORAGE_LIMIT_BYTES / 1048576} MB storage limit, because one day's docket is that large on its own.`);
    }
    const objectPath = volumePath(project.id, month, part, plan.length);
    const { error: uploadError } = await admin.storage
      .from('exports')
      .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new Error(`Could not store part ${part} of the bundle: ${uploadError.message}`);
    volumes.push({
      part,
      of: plan.length,
      objectPath,
      bytes: pdf.length,
      entryNos: indices.map((index) => entries[index].entry_no),
      from: entries[indices[0]].entry_date,
      to: entries[indices[indices.length - 1]].entry_date,
    });
  }

  return { data, volumes };
}
