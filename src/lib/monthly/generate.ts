import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadMonthEntries, monthRange, type MonthData } from './bundle';
import { renderMonthlyBundle } from './render';
import { planVolumes, volumePath, STORAGE_LIMIT_BYTES } from './volumes';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos } from '@/lib/pdf/photos';
import { collectSignatures } from '@/lib/pdf/photos';
import { renderDailyPdf } from '@/lib/pdf/render';

type Project = { id: string; name: string; code: string; orgCode: string };
type Admin = ReturnType<typeof createAdminClient>;

export interface BundlePart {
  part: number;
  of: number;
  objectPath: string;
  entryNos: string[];
  from: string;
  to: string;
  /** Sum of the dockets' sizes — the part is a little larger for its cover. */
  estimatedBytes: number;
  /** Stored already for exactly this record, so it need not be built again. */
  ready: boolean;
  /** Stored size when ready. */
  bytes: number | null;
}

export interface BundlePlan {
  data: MonthData;
  parts: BundlePart[];
  /** Which part each entry is in, for the covers. */
  partOf: Map<string, number>;
  indices: number[][];
  /** Identifies this exact set of parts. A part asked for under another plan is refused (README R78). */
  planKey: string;
}

const PAGE = 1000;

/** Every object in a folder, with its size — paged, so a long job is not cut off at 1,000 files. */
async function listSizes(admin: Admin, folder: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from('exports').list(folder, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list exports: ${error.message}`);
    for (const object of data ?? []) {
      const size = (object.metadata as { size?: number } | null)?.size;
      if (typeof size === 'number') sizes.set(object.name, size);
    }
    if ((data ?? []).length < PAGE) return sizes;
  }
}

/**
 * The month's parts, without binding any. Each stored daily export is used as
 * it is (a signed entry's PDF is the record, never regenerated over); a docket
 * never exported is rendered and stored first, because its size decides the
 * parts. README R71.
 */
export async function planMonthlyBundle(supabase: SupabaseClient, project: Project, month: string): Promise<BundlePlan | { empty: true }> {
  const entries = await loadMonthEntries(supabase, project.id, month);
  if (entries.length === 0) return { empty: true };
  const { start, end } = monthRange(month);
  const data: MonthData = { project, month, start, end, entries };

  const admin = createAdminClient();
  const [stored, built] = await Promise.all([listSizes(admin, project.id), listSizes(admin, `${project.id}/monthly`)]);

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

  const indices = planVolumes(sizes);
  const partOf = new Map<string, number>();
  indices.forEach((group, i) => { for (const index of group) partOf.set(entries[index].id, i + 1); });
  // The cover lists the whole month, so every part's key covers every entry, plus its place in the set.
  const monthHash = createHash('sha256').update(entries.map((e) => `${e.entry_no}:${e.content_hash ?? e.id}:${e.superseded_by ?? ''}:${e.author_name}`).join('|')).digest('hex');

  const groupingOf = (group: number[]) => group.map((index) => entries[index].entry_no).join(',');
  const planKey = createHash('sha256').update(`${monthHash}|${project.name}|${indices.map(groupingOf).join('/')}`).digest('hex').slice(0, 16);
  const parts = indices.map((group, i): BundlePart => {
    const part = i + 1;
    // The record, the project's name on the covers, and exactly which dockets this part holds.
    const key = createHash('sha256').update(`${monthHash}|${project.name}#${part}/${indices.length}|${groupingOf(group)}`).digest('hex').slice(0, 12);
    const objectPath = volumePath(project.id, month, part, indices.length, key);
    const name = objectPath.slice(`${project.id}/monthly/`.length);
    const storedBytes = indices.length > 1 ? built.get(name) ?? null : null;
    return {
      part,
      of: indices.length,
      objectPath,
      entryNos: group.map((index) => entries[index].entry_no),
      from: entries[group[0]].entry_date,
      to: entries[group[group.length - 1]].entry_date,
      estimatedBytes: group.reduce((sum, index) => sum + sizes[index], 0),
      ready: storedBytes != null,
      bytes: storedBytes,
    };
  });
  return { data, parts, partOf, indices, planKey };
}

/** Bind and store one part (or say it is already stored). One part is one request's worth of work. */
export async function buildBundlePart(plan: BundlePlan, partNo: number): Promise<BundlePart> {
  const part = plan.parts[partNo - 1];
  if (!part) throw new Error(`There is no part ${partNo}; this month has ${plan.parts.length}.`);
  if (part.ready) return part;
  const { data } = plan;
  const admin = createAdminClient();
  const dailyPdfs: Uint8Array[] = [];
  for (const index of plan.indices[partNo - 1]) {
    const entry = data.entries[index];
    const { data: file } = await admin.storage.from('exports').download(`${data.project.id}/${entry.entry_no}.pdf`);
    if (!file) throw new Error(`The stored daily PDF for ${entry.entry_no} could not be read. Try again in a moment.`);
    dailyPdfs.push(new Uint8Array(await file.arrayBuffer()));
  }
  const pdf = await renderMonthlyBundle(data, dailyPdfs, { part: part.part, of: part.of, partOf: plan.partOf });
  if (pdf.length > STORAGE_LIMIT_BYTES) {
    throw new Error(`Part ${part.part} is ${Math.round(pdf.length / 1048576)} MB, over the ${STORAGE_LIMIT_BYTES / 1048576} MB storage limit, because one day's docket is that large on its own.`);
  }
  const { error } = await admin.storage
    .from('exports')
    .upload(part.objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Could not store part ${part.part}: ${error.message}`);
  const done = { ...part, ready: true, bytes: pdf.length };
  plan.parts[partNo - 1] = done;
  return done;
}

/**
 * Build every part not yet stored, stopping before `deadline` (epoch ms) —
 * for the nightly job, which picks up where it left off the next night.
 */
export async function generateMonthlyBundle(
  supabase: SupabaseClient,
  project: Project,
  month: string,
  deadline = Number.POSITIVE_INFINITY,
): Promise<BundlePlan | { empty: true }> {
  const plan = await planMonthlyBundle(supabase, project, month);
  if ('empty' in plan) return plan;
  for (const part of plan.parts) {
    if (part.ready) continue;
    // Do not START a part after the deadline; one part takes well under a minute once Chromium is warm.
    if (Date.now() > deadline) break;
    await buildBundlePart(plan, part.part);
  }
  return plan;
}
