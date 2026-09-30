import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Recording a safety data sheet: the ONE way a sheet enters the register,
 * whichever screen it is recorded from (the product's own page, or Registers —
 * README R118). File first, then the row; a refused row clears its file. The
 * newest sheet becomes the one the register holds and the older ones are
 * retired — never rewritten, never deleted.
 */
export async function addSafetyDataSheet(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    productId: string;
    issuedOn: string;
    version: string | null;
    file: File | null;
    userId: string;
    /** The product's sheets as the screen holds them, to retire the older ones. */
    existing: ReadonlyArray<{ id: string; issued_on: string; active: boolean }>;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  let filePath: string | null = null;
  if (input.file) {
    const ext = (input.file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
    filePath = `${input.orgId}/${input.productId}/${id}.${ext}`;
    const { error: upErr } = await supabase.storage.from('chemical-sds')
      .upload(filePath, input.file, { contentType: input.file.type || 'application/pdf', upsert: false });
    if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
  }
  const { error: e } = await supabase.from('chemical_sds')
    .insert({ id, product_id: input.productId, issued_on: input.issuedOn, version: input.version, file_path: filePath, created_by: input.userId });
  if (e) {
    // The exact path made above, and only that one.
    if (filePath) await supabase.storage.from('chemical-sds').remove([filePath]).catch(() => undefined);
    throw new Error(e.message);
  }
  const older = input.existing.filter((s) => s.active && s.issued_on <= input.issuedOn).map((s) => s.id);
  if (older.length > 0) await supabase.from('chemical_sds').update({ active: false }).in('id', older);
}
