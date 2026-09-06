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
    // A title that is only a file code ("01B3161") is no use on a citation;
    // take the first real heading off page one instead, once.
    const { data: current } = await admin.from('project_documents').select('title').eq('id', documentId).single();
    // Drawings are one page and their sheet number *is* their name; only a
    // multi-page spec or report gets a heading read off its cover.
    const looksLikeCode = current && /^[0-9A-Z_-]{4,}$/i.test(current.title) && !/\s/.test(current.title);
    const multiPage = (extraction.pageCount ?? extraction.pages.length) > 1;
    const heading = looksLikeCode && multiPage ? firstHeading(extraction.pages[0]?.text ?? '') : null;
    await admin
      .from('project_documents')
      .update({ status: 'ready', pages: extraction.pageCount, chars, method: extraction.method, indexed_at: new Date().toISOString(), error: extraction.note ?? null, ...(heading ? { title: heading } : {}) })
      .eq('id', documentId);
    return { ok: true, pages: extraction.pageCount, chunks: chunks.length, method: extraction.method };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not read the document.';
    await admin.from('project_documents').update({ status: 'failed', error: reason.slice(0, 500) }).eq('id', documentId);
    return { ok: false, reason };
  }
}

/**
 * The line on the cover that reads like the document's title: the longest
 * all-capitals line among the first dozen candidates ("TECHNICAL
 * SPECIFICATION", "GEOTECHNICAL INVESTIGATION REPORT"), else the first plain
 * line. Company names, addresses, URLs and boilerplate are skipped.
 */
function firstHeading(pageText: string): string | null {
  const candidates: string[] = [];
  for (const raw of pageText.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < 8 || line.length > 90) continue;
    if (!/[A-Za-z]{3,}/.test(line)) continue;
    if (/^(page|rev|revision|issued|date|ref|doc no|confidential|copyright|match line|manufacturer|building)\b/i.test(line)) continue;
    if (/\b(pty|ltd|abn|acn|www\.|@|street|terrace|level \d|po box|telephone|phone)\b/i.test(line)) continue;
    if (/\b(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s+\d{4}\b/.test(line) || /\b\d{4}$/.test(line)) continue;
    if (/^\d/.test(line) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) continue;
    candidates.push(line.replace(/\s*[–-]\s*$/, ''));
    if (candidates.length >= 12) break;
  }
  if (candidates.length === 0) return null;
  const caps = candidates.filter((c) => c === c.toUpperCase() && /[A-Z]/.test(c) && c.split(' ').length >= 2);
  if (caps.length > 0) return caps.reduce((a, b) => (b.length > a.length ? b : a));
  return candidates[0];
}
