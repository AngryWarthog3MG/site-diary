import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadWeeklyData, type WeeklyData } from './load';
import { generateNarrative } from './narrative';
import { renderWeeklyPdf } from './render';

/**
 * One weekly report, generated and stored — shared by the on-demand route
 * (caller's RLS) and the Friday distribution cron (service role; every
 * fixed query already filters by project id, so the scope is identical).
 */

export interface WeeklyGeneration {
  data: WeeklyData;
  pdf: Uint8Array;
  objectPath: string;
  commentary: boolean;
  narrativeFailure?: string;
}

const EXPORTS_BUCKET = 'exports';

export async function generateWeeklyReport(
  supabase: SupabaseClient,
  project: { id: string; name: string; code: string; orgCode: string },
  start: string,
  end: string,
): Promise<WeeklyGeneration | { empty: true }> {
  const data = await loadWeeklyData(supabase, project, start, end);
  if (data.entries.length === 0) return { empty: true };

  const { result: narrative, rejected, failure } = await generateNarrative(data);
  const narrativeNote = rejected
    ? 'Commentary was withheld: the draft referenced figures not present in the record.'
    : narrative
      ? undefined
      : 'Commentary could not be generated for this report.';

  const pdf = await renderWeeklyPdf({
    data,
    narrative: narrative?.narrative ?? null,
    narrativeNote,
  });

  const objectPath = `${project.id}/weekly/${start}_${end}.pdf`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
  if (uploadError) throw new Error(`Could not store the weekly PDF: ${uploadError.message}`);

  return { data, pdf, objectPath, commentary: narrative != null, narrativeFailure: failure };
}
