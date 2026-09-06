import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { chunkPages } from './chunk';
import { extractText } from './extract';

export const DOCUMENTS_BUCKET = 'project-documents';

/**
 * Read one uploaded document into search chunks. Idempotent: re-running
 * replaces the chunks. Status moves uploaded → indexing → ready | failed so
 * the screen can say what is happening and Ask only searches what is ready.
 */
export async function indexDocument(documentId: string): Promise<{ ok: true; pages: number | null; chunks: number; method: string } | { ok: false; reason: string }> {
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from('project_documents')
    .select('id, storage_path, mime_type')
    .eq('id', documentId)
    .maybeSingle();
  if (!doc) return { ok: false, reason: 'Document not found.' };

  await admin.from('project_documents').update({ status: 'indexing', error: null }).eq('id', documentId);
  try {
    const { data: file, error: dlError } = await admin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path);
    if (dlError || !file) throw new Error(dlError?.message ?? 'The file is missing from storage.');
    const buffer = Buffer.from(await file.arrayBuffer());
    const extraction = await extractText(buffer, doc.mime_type);
    const chunks = chunkPages(extraction.pages);
    if (chunks.length === 0) throw new Error('No readable text was found in this document.');

    await admin.from('project_document_chunks').delete().eq('document_id', documentId);
    for (let i = 0; i < chunks.length; i += 200) {
      const { error } = await admin
        .from('project_document_chunks')
        .insert(chunks.slice(i, i + 200).map((c) => ({ document_id: documentId, page: c.page, seq: c.seq, text: c.text })));
      if (error) throw new Error(error.message);
    }
    const chars = chunks.reduce((n, c) => n + c.text.length, 0);
    await admin
      .from('project_documents')
      .update({ status: 'ready', pages: extraction.pageCount, chars, method: extraction.method, indexed_at: new Date().toISOString(), error: extraction.note ?? null })
      .eq('id', documentId);
    return { ok: true, pages: extraction.pageCount, chunks: chunks.length, method: extraction.method };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not read the document.';
    await admin.from('project_documents').update({ status: 'failed', error: reason.slice(0, 500) }).eq('id', documentId);
    return { ok: false, reason };
  }
}
