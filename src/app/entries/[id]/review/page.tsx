import Link from 'next/link';
import { fmtDate } from '@/lib/pdf/dates';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, canAuthorEntries } from '@/lib/auth';
import { ReviewPayload } from '@/lib/review/schema';
import type { SectionKey } from '@/lib/extraction/schema';
import { ReviewScreen } from './review-screen';
import { fillDelayMinutes } from '@/lib/review/minutes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Diary entry · KBS Daily Diary' };

type Row = Record<string, unknown>;

/**
 * Screen 3 (brief §7.3).
 *
 * The initial state comes from the stored child rows if the entry has been
 * saved before, and from the pending extraction proposal if it has not. Once
 * the supervisor has confirmed anything, what is stored is what they confirmed
 * — the proposal never overwrites their work.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from('entries')
    .select(
      `id, project_id, entry_date, status, author_id, transcript_raw, entry_no, notes,
       project:projects!inner(id, name, code, org:organisations!inner(code)),
       labour(*), plant(*), work_items(*), variations(*), delays(*), pours(*),
       quantities(*), dayworks(*), photos(*), entry_signatures(*), entry_sections(*), weather(*)`,
    )
    .eq('id', id)
    .maybeSingle();

  if (!entry) notFound();
  if (entry.status === 'signed') redirect(`/entries/${id}/signed`);
  // A day belongs to the job. Its author works on it, and so may anyone with
  // an authoring role there; a PM or leading hand reads it instead.
  const canEdit =
    entry.author_id === userId ||
    memberships.some((m) => m.project_id === entry.project_id && canAuthorEntries(m.role));
  if (!canEdit) redirect(`/entries/${id}/signed`);
  let startedBy: string | null = null;
  if (entry.author_id !== userId) {
    const { data: author } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', entry.author_id)
      .maybeSingle();
    startedBy = author?.full_name ?? author?.email ?? 'someone else';
  }

  // Machines with a signed plant prestart on this day, so the review can ask
  // about any plant that worked without one.
  const { data: prestartedRows } = await supabase
    .from('plant_prestarts')
    .select('plant:plant_register!inner(name)')
    .eq('project_id', entry.project_id)
    .eq('prestart_date', entry.entry_date)
    .not('completed_at', 'is', null);
  const plantPrestarted = (prestartedRows ?? [])
    .map((r) => { const p = Array.isArray(r.plant) ? r.plant[0] : r.plant; return (p as { name?: string } | null)?.name ?? ''; })
    .filter(Boolean);

  const { data: extraction } = await supabase
    .from('entry_extractions')
    .select('id, proposal, status, created_at')
    .eq('entry_id', id)
    .eq('status', 'pending')
    .maybeSingle();

  const proposal = (extraction?.proposal ?? null) as Partial<ReviewPayload> | null;
  const stored = entry as unknown as Row;

  const rows = (key: string) => ((stored[key] as Row[] | null) ?? []);
  const hasStored =
    [
      'labour',
      'plant',
      'work_items',
      'variations',
      'delays',
      'pours',
      'quantities',
      'dayworks',
      'photos',
    ].some((key) => rows(key).length > 0);

  const pick = <T,>(key: string, fallback: T[]): T[] =>
    hasStored ? (rows(key) as unknown as T[]) : fallback;

  const weather = firstOrNull(stored.weather);

  const assembled = {
    labour: pick('labour', proposal?.labour ?? []),
    plant: pick('plant', proposal?.plant ?? []),
    work_items: pick('work_items', proposal?.work_items ?? []),
    // Directed by / at and a value are off the form: nothing the supervisor
    // cannot see may ride in from a proposal and be saved unseen.
    variations: pick(
      'variations',
      ((proposal?.variations ?? []) as Array<Record<string, unknown>>).map((v) => ({ ...v, directed_by: null, directed_at: null, estimated_cost: null })),
    ),
    // A delay spoken as a span arrives with two times and no minutes (the model
    // never computes one). The minutes between them are arithmetic, filled here
    // so the docket and the weekly count the delay; the supervisor confirms it.
    delays: fillDelayMinutes(pick('delays', proposal?.delays ?? [])),
    pours: pick('pours', proposal?.pours ?? []),
    quantities: pick('quantities', proposal?.quantities ?? []),
    dayworks: pick(
      'dayworks',
      ((proposal?.dayworks ?? []) as Array<Record<string, unknown>>).map((d) => ({ ...d, docket_ref: null })),
    ),
    photos: pick('photos', proposal?.photos ?? []),
    // Only a reading the supervisor entered by hand seeds the editable form.
    // BOM numbers are shown read-only from the stored row; putting them in
    // the payload would round-trip them back as "manual" and destroy the
    // station provenance the record depends on.
    weather:
      weather?.source === 'manual'
        ? {
            temp_max: (weather?.temp_max as number | null) ?? null,
            temp_min: (weather?.temp_min as number | null) ?? null,
            rainfall_mm: (weather?.rainfall_mm as number | null) ?? null,
            wind_dir: (weather?.wind_dir as string | null) ?? null,
            wind_kmh: (weather?.wind_kmh as number | null) ?? null,
          }
        : {
            temp_max: null,
            temp_min: null,
            rainfall_mm: null,
            wind_dir: null,
            wind_kmh: null,
          },
    sections: [],
    weather_impact:
      (weather?.observed_impact as string | null) ??
      ((proposal as { weather_impact?: string | null } | null)?.weather_impact ?? null),
    signatures: (rows('entry_signatures') as unknown as Array<Record<string, unknown>>).map(
      (row) => ({
        role: row.role,
        signatory_name: row.signatory_name,
        image_path: row.image_path,
      }),
    ),
    notes:
      (stored.notes as string | null) ??
      ((proposal as { notes?: string | null } | null)?.notes ?? null),
  };

  /**
   * Through the contract, not straight onto the screen.
   *
   * The rows above come from two different shapes — stored child tables and
   * the extraction proposal — and the extraction has no photo_urls or
   * docket_photo_urls at all, because photos are taken at review rather than
   * spoken. Handing that raw shape to the review screen crashed it on the
   * first real recording that contained a variation. Parsing fills every
   * default the contract defines, so the screen only ever sees review-shaped
   * data. safeParse, because a malformed proposal should degrade to an empty
   * docket with the transcript still visible — not a dead page.
   */
  const parsed = ReviewPayload.safeParse(assembled);
  if (!parsed.success) {
    console.error('review: payload did not fit the contract', parsed.error.issues[0]);
    // Stored rows that will not parse are a fault in the app, never an empty
    // day. On 2026-09-11 a new field rejected null and every day with an
    // older variation opened blank — and an empty form with autosave behind
    // it is one tap from deleting what it failed to show. Refuse to render
    // the editor; nothing is touched.
    if (hasStored) {
      return (
        <main className="sheet">
          <p className="label">Daily diary · {fmtDate(entry.entry_date)}</p>
          <p className="notice gap">
            This day could not be opened. Everything recorded on it is safe in the record and nothing
            has been changed — the app could not read one of its fields. Refresh once; if it persists,
            tell the office. Do not re-type the day.
          </p>
          <Link className="button button--quiet" href={`/entries/${id}/docket`}>See what is recorded (read only)</Link>
          <Link className="button button--quiet" href="/">Home</Link>
        </main>
      );
    }
  }
  const initial: ReviewPayload = parsed.success
    ? parsed.data
    : ReviewPayload.parse({ weather_impact: assembled.weather_impact ?? null });

  // A confirmed nil is the supervisor's own answer, so it survives from
  // whichever source already holds it.
  const storedSections = rows('entry_sections') as Array<{ section: SectionKey; state: string }>;
  const proposalSections = (proposal as { sections?: Record<string, { state: string }> } | null)
    ?.sections;

  const nilConfirmed = new Set<SectionKey>();
  for (const row of storedSections) {
    if (row.state === 'nil_confirmed') nilConfirmed.add(row.section);
  }
  if (storedSections.length === 0 && proposalSections) {
    for (const [key, value] of Object.entries(proposalSections)) {
      if (value?.state === 'nil_confirmed') nilConfirmed.add(key as SectionKey);
    }
  }

  const project = firstOrNull(stored.project) as
    | { id: string; name: string; code: string; org: { code: string } | { code: string }[] }
    | null;
  const orgCode =
    (Array.isArray(project?.org) ? project?.org[0]?.code : project?.org?.code) ?? '';

  return (
    <ReviewScreen
      entryId={entry.id}
      projectId={entry.project_id}
      projectName={project?.name ?? 'Project'}
      projectCode={`${orgCode}-${project?.code ?? ''}`}
      entryDate={entry.entry_date}
      transcript={entry.transcript_raw}
      initial={initial}
      initialNilConfirmed={[...nilConfirmed]}
      weather={weather as ReviewWeather | null}
      hasProposal={Boolean(extraction)}
      hasStored={hasStored}
      startedBy={startedBy}
      plantPrestarted={plantPrestarted}
    />
  );
}

export interface ReviewWeather {
  temp_max: number | null;
  temp_min: number | null;
  rainfall_mm: number | null;
  wind_dir: string | null;
  wind_kmh: number | null;
  station_name: string | null;
  station_distance_km: number | null;
  source: string | null;
  observed_impact: string | null;
}

/** PostgREST returns an embedded one-to-one as an object; the untyped client cannot know that. */
function firstOrNull(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  return (value as Row | null) ?? null;
}
