import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_CONTEXT } from '@/lib/pdf/photos';
import { perthDate } from '@/lib/pdf/dates';
import { incidentRef, KIND_LABEL, type IncidentKind } from '@/lib/incidents/model';
import { distinctPhotos, type LibraryPhoto } from './library';

/**
 * Every photograph on a job, under the caller's RLS (README R173).
 *
 * Two sources, the same as the weekly's gathering (`weekly/photos.ts`) plus the crew's:
 *   - the diary — each day's own photographs and the ones on its variations, dayworks, instructions
 *     and concrete dockets; the CURRENT version of a day only, a corrected day showing the correction,
 *     drafts included and marked;
 *   - `day_photos` — what the crew added to a day (README R172). One that the supervisor has carried
 *     onto the day is the same file, so it falls together with the diary's by path;
 *   - and since README R184 the records that keep their own photographs, each under its own read rule:
 *     hazard and incident reports (the report's on the day it happened, an update's on the day of the
 *     update) and inspection and test records (on the day each file was uploaded, as Storage dates it).
 *
 * Nothing here is a copy: the library lists the record's own files and signs links to them for the
 * hour. A photograph removed from a day's draft is not on the day and is not listed.
 */
type Row = Record<string, unknown>;

export async function loadPhotoLibrary(
  supabase: SupabaseClient,
  projectId: string,
  range: { from?: string; to?: string } = {},
): Promise<LibraryPhoto[]> {
  let query = supabase
    .from('entries')
    .select(
      `id, entry_no, entry_date, status, supersedes_entry_id, created_at,
       photos(url, caption, category, created_at),
       variations(register_seq, description, photo_urls),
       dayworks(description, photo_urls),
       site_events(said_text, photo_urls),
       pours(location, docket_photo_urls)`,
    )
    .eq('project_id', projectId);
  if (range.from) query = query.gte('entry_date', range.from);
  if (range.to) query = query.lte('entry_date', range.to);
  const { data } = await query.order('entry_date').order('created_at');
  const rows = (data ?? []) as Row[];
  const superseded = new Set(rows.map((r) => r.supersedes_entry_id as string | null).filter(Boolean));
  const current = rows.filter((r) => !superseded.has(r.id as string));

  const out: LibraryPhoto[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  for (const entry of current) {
    const base = { date: String(entry.entry_date), entryNo: (entry.entry_no as string | null) ?? null, day: entry.status === 'signed' ? ('signed' as const) : ('draft' as const), source: 'diary' as const, by: null };
    for (const v of list(entry.variations)) {
      const seq = v.register_seq as number | null;
      const context = seq == null ? 'Variation' : `Variation V-${String(seq).padStart(3, '0')}`;
      for (const path of (v.photo_urls as string[] | null) ?? []) out.push({ ...base, path, context, caption: (v.description as string | null) ?? null });
    }
    for (const d of list(entry.dayworks)) {
      for (const path of (d.photo_urls as string[] | null) ?? []) out.push({ ...base, path, context: 'Dayworks', caption: (d.description as string | null) ?? null });
    }
    for (const ev of list(entry.site_events)) {
      for (const path of (ev.photo_urls as string[] | null) ?? []) out.push({ ...base, path, context: 'Instruction or event', caption: (ev.said_text as string | null) ?? null });
    }
    for (const p of list(entry.pours)) {
      for (const path of (p.docket_photo_urls as string[] | null) ?? []) out.push({ ...base, path, context: `Concrete docket — ${(p.location as string | null) ?? 'pour'}`, caption: null });
    }
    const own = list(entry.photos).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const p of own) {
      const category = typeof p.category === 'string' ? p.category : 'general';
      out.push({ ...base, path: p.url as string, context: PHOTO_CONTEXT[category] ?? 'Site photograph', caption: (p.caption as string | null) ?? null });
    }
  }

  // The crew's, by the day they were taken on. Those already on the day fold in by path above.
  let crew = supabase.from('day_photos').select('url, caption, taken_on, added_by, created_at').eq('project_id', projectId);
  if (range.from) crew = crew.gte('taken_on', range.from);
  if (range.to) crew = crew.lte('taken_on', range.to);
  const { data: crewRows } = await crew.order('taken_on').order('created_at');
  const crewList = (crewRows ?? []) as Array<{ url: string; caption: string | null; taken_on: string; added_by: string; created_at: string }>;
  const names = new Map<string, string | null>();
  if (crewList.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(crewList.map((r) => r.added_by))]);
    for (const pr of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(pr.id, pr.full_name);
  }
  const dayOf = new Map(current.map((e) => [String(e.entry_date), e]));
  for (const r of crewList) {
    const day = dayOf.get(r.taken_on);
    out.push({
      date: r.taken_on,
      path: r.url,
      context: 'Progress photograph',
      caption: r.caption,
      entryNo: (day?.entry_no as string | null) ?? null,
      // The day it was taken on, as it stands; the photograph itself is not on that day until the supervisor keeps it there.
      day: day ? (day.status === 'signed' ? 'signed' : 'draft') : 'none',
      source: 'crew',
      by: names.get(r.added_by) ?? null,
    });
  }
  // The day's standing for a photograph that is not on the diary: the day as it stands, nothing more.
  const standing = (date: string): Pick<LibraryPhoto, 'entryNo' | 'day'> => {
    const day = dayOf.get(date);
    return { entryNo: (day?.entry_no as string | null) ?? null, day: day ? (day.status === 'signed' ? 'signed' : 'draft') : 'none' };
  };
  const inRange = (date: string) => (!range.from || date >= range.from) && (!range.to || date <= range.to);

  // Hazards and incidents (README R184): the report's photographs on the day it happened, an update's on its own day.
  const { data: incRows } = await supabase.from('incidents').select('id, seq, kind, occurred_at, location, photo_urls, reported_by, incident_updates(body, photo_urls, created_at)').eq('project_id', projectId);
  const incidents = (incRows ?? []) as Array<{ id: string; seq: number; kind: string; occurred_at: string; location: string | null; photo_urls: string[] | null; reported_by: string; incident_updates: Array<{ body: string; photo_urls: string[] | null; created_at: string }> | null }>;
  const reporters = [...new Set(incidents.map((i) => i.reported_by))].filter((id) => !names.has(id));
  if (reporters.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', reporters);
    for (const pr of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(pr.id, pr.full_name);
  }
  for (const i of incidents) {
    const context = `${incidentRef(i.seq)} · ${KIND_LABEL[i.kind as IncidentKind] ?? i.kind}`;
    const date = perthDate(i.occurred_at);
    if (date && inRange(date)) for (const path of i.photo_urls ?? []) out.push({ date, path, context, caption: i.location, ...standing(date), source: 'incident', by: names.get(i.reported_by) ?? null });
    for (const u of i.incident_updates ?? []) {
      const d = perthDate(u.created_at);
      if (d && inRange(d)) for (const path of u.photo_urls ?? []) out.push({ date: d, path, context: `${context} · update`, caption: u.body, ...standing(d), source: 'incident', by: names.get(i.reported_by) ?? null });
    }
  }

  // Inspection and test records (README R184): the record's own photographs and each item's, dated by the upload
  // Storage recorded — a record has no day of its own; a file that Storage does not list is dated by the record's start.
  const { data: qaRows } = await supabase.from('qa_records').select('id, lot_or_element, photo_paths, items, client_created_at, template:qa_templates(code, title)').eq('project_id', projectId).is('voided_at', null);
  type QaRow = { id: string; lot_or_element: string | null; photo_paths: string[] | null; items: Array<{ item_id: string; photo_paths?: string[] }> | null; client_created_at: string; template: { code: string; title: string } | Array<{ code: string; title: string }> | null };
  for (const r of (qaRows ?? []) as QaRow[]) {
    const itemPhotos = (Array.isArray(r.items) ? r.items : []).flatMap((it) => (it.photo_paths ?? []).map((path) => ({ path, item: it.item_id })));
    const own = (r.photo_paths ?? []).map((path) => ({ path, item: null as string | null }));
    if (own.length + itemPhotos.length === 0) continue;
    const t = (Array.isArray(r.template) ? r.template[0] : r.template) ?? null;
    const context = `${t?.code ?? 'ITR'} · ${r.lot_or_element ?? t?.title ?? 'record'}`;
    const { data: files } = await supabase.storage.from('entry-photos').list(`${projectId}/qa/${r.id}`, { limit: 1000 });
    const uploaded = new Map<string, string>();
    for (const f of (files ?? []) as Array<{ name: string; created_at?: string }>) if (f.created_at) uploaded.set(`${projectId}/qa/${r.id}/${f.name}`, f.created_at);
    for (const { path, item } of [...own, ...itemPhotos]) {
      const date = perthDate(uploaded.get(path) ?? r.client_created_at);
      if (!date || !inRange(date)) continue;
      out.push({ date, path, context, caption: item ? `Item ${item}` : null, ...standing(date), source: 'qa', by: null });
    }
  }
  return distinctPhotos(out);
}

/** Signed links for the hour, one call per hundred paths. */
export async function signPhotoUrls(supabase: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  const distinct = [...new Set(paths)];
  for (let i = 0; i < distinct.length; i += 100) {
    const { data } = await supabase.storage.from('entry-photos').createSignedUrls(distinct.slice(i, i + 100), 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  return urls;
}
