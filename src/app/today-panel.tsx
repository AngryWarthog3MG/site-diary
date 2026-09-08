'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { EntrySection } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { detectSections } from '@/lib/capture/sections';
import { localDate } from '@/lib/capture/queue';
import * as sync from '@/lib/capture/sync';
import { SectionChips } from '@/components/section-chips';
import { QueueStatus } from '@/components/queue-status';
import { ReminderToggle } from '@/components/reminder-toggle';
import { fmtDate } from '@/lib/pdf/dates';
import { isRestDay } from '@/lib/calendar';

interface WeatherRow {
  temp_max: number | null;
  temp_min: number | null;
  rainfall_mm: number | null;
  wind_dir: string | null;
  wind_kmh: number | null;
  station_name: string | null;
  station_distance_km: number | null;
  source?: string | null;
}

interface TodayEntry {
  id: string;
  status: string;
  entry_no: string | null;
  transcript_raw: string | null;
  segments: number;
  awaitingTranscription: number;
  hasProposal: boolean;
  hasRecord: boolean;
}

const n = (value: number | null, unit: string, digits = 1) =>
  value == null ? '—' : `${value.toFixed(digits)}${unit}`;

function firstOrNull<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

/**
 * The live half of the Today screen.
 *
 * Client-side because the entry date has to be the *device's* local date —
 * a Perth knock-off at 17:30 is already tomorrow in UTC, and the diary would
 * open the wrong day.
 */
export function TodayPanel({
  projectId,
  canRecord,
  canPrestart,
  roleLabel,
}: {
  projectId: string;
  canRecord: boolean;
  canPrestart: boolean;
  roleLabel: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [writingOut, setWritingOut] = useState(false);
  const [entry, setEntry] = useState<TodayEntry | null>(null);
  const [prestart, setPrestart] = useState<{ id: string; done: boolean; signed: number } | null>(null);
  const [tomorrowPrestart, setTomorrowPrestart] = useState<{ id: string; date: string } | null>(null);
  const [weather, setWeather] = useState<WeatherRow | null>(null);
  const [weatherNote, setWeatherNote] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [unfinished, setUnfinished] = useState<Array<{
    id: string; date: string; mine: boolean; labour: number; words: boolean; correctionOf: string | null;
  }>>([]);
  const [binning, setBinning] = useState<string | null>(null);
  const [week, setWeek] = useState<Array<{ date: string; label: string; state: string; href: string | null }>>([]);
  // The week's weather, one reading per day, from the same entries the strip
  // is built from. Wet days are what a delay claim leans on later.
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  /**
   * Work already retried this session.
   *
   * Transcription and extraction are kicked off by the sync queue, and the
   * queue item is deleted as soon as the recording is safely on the server —
   * which is correct, but it means a *failed* transcript has nothing left to
   * retry it. A bad API key, a rate limit, a dropped connection, and the entry
   * sits there with audio and no words, for good.
   *
   * So Today picks up the unfinished work. The set stops it looping on
   * something that keeps failing: one attempt per entry per visit, and
   * reopening the screen tries again.
   */
  const attempted = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const today = localDate();
    setDate(today);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('entries')
        .select(
          `id, status, entry_no, transcript_raw, entry_audio(id, transcript_status), weather(*),
           entry_extractions(id, status), labour(id)`,
        )
        .eq('project_id', projectId)
        .eq('entry_date', today)
        .eq('author_id', user.id)
        .is('supersedes_entry_id', null)
        .maybeSingle();

      // Today's prestart: done, open, or not started. It is the first thing
      // that happens on a site each morning, so it sits at the top of Today.
      {
        const { data: ps } = await supabase
          .from('prestarts')
          .select('id, completed_at, prestart_attendees(id)')
          .eq('project_id', projectId)
          .eq('prestart_date', today)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setPrestart(
          ps
            ? { id: ps.id as string, done: Boolean(ps.completed_at),
                signed: ((ps.prestart_attendees ?? []) as unknown[]).length }
            : null,
        );
        // One saved the night before shows here so the evening's work is visible.
        const next = new Date(`${today}T12:00:00`);
        next.setDate(next.getDate() + 1);
        const { data: tm } = await supabase
          .from('prestarts')
          .select('id, prestart_date')
          .eq('project_id', projectId)
          .eq('prestart_date', localDate(next))
          .is('completed_at', null)
          .limit(1)
          .maybeSingle();
        setTomorrowPrestart(tm ? { id: tm.id as string, date: tm.prestart_date as string } : null);
      }

      if (data) {
        const segments = (data.entry_audio ?? []) as Array<{ transcript_status: string }>;
        const extractions = (data.entry_extractions ?? []) as Array<{ status: string }>;
        setEntry({
          id: data.id,
          status: data.status,
          entry_no: (data.entry_no as string | null) ?? null,
          transcript_raw: data.transcript_raw,
          segments: segments.length,
          awaitingTranscription: segments.filter((s) => s.transcript_status !== 'done').length,
          hasProposal: extractions.some((e) => e.status === 'pending'),
          hasRecord: ((data.labour ?? []) as unknown[]).length > 0,
        });
        // PostgREST returns an embedded one-to-one as an object, but the
        // untyped client cannot know that — accept either shape.
        setWeather(firstOrNull<WeatherRow>(data.weather));
      } else {
        setEntry(null);
      }
      setOffline(false);

      // The last week's holes: days after the project's first entry with no
      // entry from anyone. Silence is the failure mode a diary can't see.
      {
        const since = new Date(`${today}T00:00:00`);
        since.setDate(since.getDate() - 7);
        const sinceStr = localDate(since);
        const { data: recent } = await supabase
          .from('entries')
          .select('id, entry_date, status, author_id, supersedes_entry_id, weather(temp_max, temp_min, rainfall_mm, wind_dir, wind_kmh, source)')
          .eq('project_id', projectId)
          .gte('entry_date', sinceStr);
        const { data: first } = await supabase
          .from('entries')
          .select('entry_date')
          .eq('project_id', projectId)
          .order('entry_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        // The week at a glance: the trailing seven days, each with its
        // strongest state — a signed day beats a lingering draft on the
        // same date. The strip is the habit made visible.
        {
          // Each day's best row, and where a tap on it should go: the current
          // signed version if there is one, otherwise the open draft (yours
          // to finish, someone else's to look at), otherwise record that day.
          type RecentRow = { id: string; entry_date: string; status: string; author_id: string; supersedes_entry_id: string | null; weather?: unknown };
          const rows = (recent ?? []) as RecentRow[];
          const replaced = new Set(rows.filter((r) => r.status === 'signed' && r.supersedes_entry_id).map((r) => r.supersedes_entry_id as string));
          const byDate = new Map<string, { status: string; href: string }>();
          for (const row of rows) {
            const date = row.entry_date;
            const have = byDate.get(date);
            if (row.status === 'signed') {
              if (replaced.has(row.id)) continue;
              byDate.set(date, { status: 'signed', href: `/entries/${row.id}/signed` });
            } else if (!have || have.status !== 'signed') {
              const mine = row.author_id === user.id;
              if (!have || (mine && !have.href.endsWith('/review'))) {
                byDate.set(date, { status: 'draft', href: mine ? `/entries/${row.id}/review` : `/entries/${row.id}/signed` });
              }
            }
          }
          const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
          const strip: Array<{ date: string; label: string; state: string; href: string | null }> = [];
          const cursor = new Date(`${today}T00:00:00`);
          cursor.setDate(cursor.getDate() - 6);
          for (let i = 0; i < 7; i += 1) {
            const date = localDate(cursor);
            const best = byDate.get(date);
            strip.push({
              date,
              label: DOW[cursor.getDay()],
              state: best ? best.status : date === today ? 'today' : isRestDay(date) ? 'rest' : 'gap',
              href: best ? best.href : date === today ? null : `/record?project=${projectId}&date=${date}`,
            });
            cursor.setDate(cursor.getDate() + 1);
          }
          setWeek(strip);
        }

        if (first) {
          // A day with only a draft has no record. It used to count as
          // covered here, which is how five half-finished days on one job
          // sat invisible for a week.
          const have = new Set(
            (recent ?? []).filter((r) => r.status === 'signed').map((r) => r.entry_date as string),
          );
          const gaps: string[] = [];
          const cursor = new Date(`${today}T00:00:00`);
          cursor.setDate(cursor.getDate() - 1);
          for (let i = 0; i < 7; i += 1) {
            const day = localDate(cursor);
            if (day < (first.entry_date as string)) break;
            // A weekend with nothing recorded is a rest day, not a missing one.
            if (!have.has(day) && !isRestDay(day)) gaps.push(day);
            cursor.setDate(cursor.getDate() - 1);
          }
          setMissingDays(gaps);
        }
      }

      // Days started and never signed. The data is already typed in for
      // some of them; the record just does not know yet.
      {
        const { data: drafts } = await supabase
          .from('entries')
          .select('id, entry_date, author_id, transcript_raw, supersedes_entry_id, labour(id)')
          .eq('project_id', projectId)
          .eq('status', 'draft')
          .lt('entry_date', today)
          .order('entry_date', { ascending: true })
          .limit(20);
        // The serials of the signed days these corrections point at — a
        // plain second lookup rather than a self-join the client has to
        // know the constraint name for.
        const priorIds = (drafts ?? [])
          .map((d) => d.supersedes_entry_id as string | null)
          .filter((v): v is string => Boolean(v));
        const priorNo = new Map<string, string>();
        if (priorIds.length > 0) {
          const { data: priors } = await supabase.from('entries').select('id, entry_no').in('id', priorIds);
          for (const p of priors ?? []) if (p.entry_no) priorNo.set(p.id as string, p.entry_no as string);
        }
        setUnfinished(
          (drafts ?? []).map((d) => ({
            id: d.id as string,
            date: d.entry_date as string,
            mine: d.author_id === user.id,
            labour: ((d.labour ?? []) as unknown[]).length,
            words: Boolean(d.transcript_raw),
            correctionOf: d.supersedes_entry_id ? (priorNo.get(d.supersedes_entry_id as string) ?? null) : null,
          })),
        );
      }

      // Everything the screen needs to say what today is has arrived. The
      // weather and any stalled-work retries below can take seconds on a
      // weak connection; the status line and prestart row should not wait.
      setLoading(false);

      // Pick up anything the sync queue started and could not finish.
      if (data) {
        const segments = (data.entry_audio ?? []) as Array<{ transcript_status: string }>;
        const stalled = segments.some((s) => s.transcript_status !== 'done');
        const extractions = (data.entry_extractions ?? []) as Array<{ status: string }>;
        const needsExtraction =
          Boolean(data.transcript_raw) && !extractions.some((e) => e.status === 'pending');

        const resume = async (kind: string, path: string) => {
          const key = `${data.id}:${kind}`;
          if (attempted.current.has(key)) return false;
          attempted.current.add(key);
          const response = await fetch(path, { method: 'POST' }).catch(() => null);
          return Boolean(response?.ok);
        };

        if (stalled && (await resume('transcribe', `/api/entries/${data.id}/transcribe`))) {
          void load();
          return;
        }
        if (needsExtraction && (await resume('extract', `/api/entries/${data.id}/extract`))) {
          void load();
          return;
        }
      }

      // Attach observations to the draft if there is one, otherwise just show
      // the current conditions. Both are best effort — no signal simply means
      // no weather on screen, and none of it blocks recording.
      const refresh =
        data && data.status !== 'signed'
          ? fetch(`/api/entries/${data.id}/weather`, { method: 'POST' })
          : fetch(`/api/projects/${projectId}/weather?date=${today}`);

      const result = await refresh.then((r) => (r.ok ? r.json() : null));
      if (result) {
        if (result.weather) setWeather(result.weather as WeatherRow);
        setWeatherNote(result.reason ?? null);
        setAttribution(result.attribution ?? null);
      }
    } catch {
      // No signal: the queue below still tells the supervisor what is on the phone.
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    // A finished sync changes what today looks like.
    return sync.subscribe(() => void load());
  }, [load]);

  /** Bin a draft that will never be finished. Signed days cannot be binned. */
  async function binDraft(id: string) {
    if (!window.confirm('Bin this unfinished day? Anything typed into it is thrown away. Signed days are never affected.')) return;
    setBinning(id);
    try {
      const response = await fetch(`/api/entries/${id}/discard`, { method: 'POST' });
      if (response.ok) void load();
    } finally {
      setBinning(null);
    }
  }

  /**
   * The written way in.
   *
   * Talking is faster on a good day, but not every day is one — a supervisor
   * on a quiet site, or one who would simply rather type, should not have to
   * record a word to keep the diary. This opens today's draft (the same draft
   * a recording would open) and goes straight to the review screen, where
   * every section already takes items by hand.
   */
  async function writeItOut() {
    setWritingOut(true);
    try {
      if (entry) {
        router.push(`/entries/${entry.id}/review`);
        return;
      }
      const response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, entryDate: localDate() }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok && json?.entryId) {
        router.push(`/entries/${json.entryId}/review`);
        return;
      }
      setWritingOut(false);
    } catch {
      // No signal. Recording still queues offline; typing needs the server.
      setOffline(true);
      setWritingOut(false);
    }
  }

  const covered: Set<EntrySection> = detectSections(entry?.transcript_raw ?? '');

  const weekday = date ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${date}T12:00:00`).getDay()] : '';
  const holes = missingDays.filter((d) => !unfinished.some((u) => u.date === d));

  // One line says what today is. The button says what to do about it, so the
  // status only speaks when there is something the button does not say.
  const status = loading
    ? null
    : offline
      ? 'No signal — this is what is saved on the phone. It syncs when you are back in range.'
      : entry
        ? entry.status === 'signed'
          ? `Signed and on the record as ${entry.entry_no ?? 'today’s entry'}.`
          : entry.awaitingTranscription > 0
            ? `${entry.segments} recording${entry.segments === 1 ? '' : 's'} saved · ${entry.awaitingTranscription} still turning into words.`
            : entry.transcript_raw
              ? `${entry.segments} recording${entry.segments === 1 ? '' : 's'} saved and written up. Check it over, then sign.`
              : null
        : null;

  return (
    <section className="home-today" aria-label="Today">
      <h1 className="home-date">
        {weekday || ' '} <span className="mono home-date__num">{date ? fmtDate(date) : ''}</span>
      </h1>
      {status && <p className="today-status">{status}</p>}

      <div className="home-actions">
        {entry?.status === 'signed' ? (
          <>
            <Link className="button" href={`/entries/${entry.id}/signed`}>View the signed entry</Link>
            {canRecord && (
              <Link className="button button--quiet" href={`/record?project=${projectId}`}>Record a correction</Link>
            )}
          </>
        ) : canRecord ? (
          <>
            <Link className="button button--record" href={`/record?project=${projectId}`}>
              {entry?.segments ? 'Talk some more' : 'Talk it through'}
            </Link>
            <button className="linklike home-typeit" type="button" disabled={writingOut} onClick={writeItOut}>
              {writingOut ? 'Opening…' : 'Type it in instead'}
            </button>
          </>
        ) : (
          <p className="notice">
            You are on this job as {roleLabel}. Recording the diary is the site supervisor&rsquo;s;
            {canPrestart ? ' your prestarts and toolbox talks are in the menu.' : ' the record and reports are in the menu.'}
          </p>
        )}
      </div>

      {canRecord && entry && entry.status !== 'signed' && (entry.hasProposal || entry.hasRecord) && (
        <Link className="button" href={`/entries/${entry.id}/review`}>
          {entry.hasRecord ? 'Back to today’s entry' : 'Check it over and sign'}
        </Link>
      )}

      {!loading && canPrestart && (
        <div className={`prestart-row ${prestart?.done ? 'prestart-row--done' : prestart ? 'prestart-row--open' : ''}`}>
          <span>
            {prestart?.done
              ? `Prestart done · ${prestart.signed} signed on`
              : prestart
                ? prestart.signed === 0
                  ? 'Prestart ready · read it out and sign the crew on'
                  : `Prestart open · ${prestart.signed} signed on so far`
                : 'No prestart yet today'}
          </span>
          {prestart ? (
            <Link href={`/prestart/${prestart.id}`}>{prestart.done ? 'View' : prestart.signed === 0 ? 'Open it' : 'Finish it'}</Link>
          ) : (
            <Link href={`/prestart/new?project=${projectId}`}>Start it</Link>
          )}
        </div>
      )}
      {!loading && canPrestart && tomorrowPrestart && (
        <div className="prestart-row prestart-row--done">
          <span>Tomorrow&rsquo;s prestart is ready · {fmtDate(tomorrowPrestart.date)}</span>
          <Link href={`/prestart/${tomorrowPrestart.id}`}>Look it over</Link>
        </div>
      )}

      {covered.size > 0 && (
        <div className="home-chips">
          <p className="caption">What you have talked about so far</p>
          <SectionChips covered={covered} />
        </div>
      )}
      <QueueStatus />

      {week.length > 0 && (
        <div className="weekstrip home-week" aria-label="The last seven days">
          {week.map((day) => {
            const title = `${fmtDate(day.date)} — ${day.state === 'signed' ? 'signed · open the diary' : day.state === 'draft' ? 'started, not signed · open it' : day.state === 'today' ? 'today' : day.state === 'rest' ? 'weekend · rest day' : 'nothing written down · record it'}`;
            return day.href ? (
              <Link key={day.date} href={day.href} className={`weekstrip__day weekstrip__day--${day.state} weekstrip__day--link`} title={title} aria-label={title}>
                <span className="weekstrip__num mono">{Number(day.date.slice(8, 10))}</span>
                <span className="weekstrip__dow">{day.label}</span>
              </Link>
            ) : (
              <span key={day.date} className={`weekstrip__day weekstrip__day--${day.state}`} title={title}>
                <span className="weekstrip__num mono">{Number(day.date.slice(8, 10))}</span>
                <span className="weekstrip__dow">{day.label}</span>
              </span>
            );
          })}
        </div>
      )}

      {(unfinished.length > 0 || holes.length > 0) && (
        <div className="unfinished home-unfinished">
          <p className="label">Not signed yet · {unfinished.length + holes.length}</p>
          {holes.map((d) => (
            <div key={d} className="unfinished__row">
              <div>
                <p className="mono unfinished__date">{fmtDate(d)}</p>
                <p className="unfinished__what">nothing written down</p>
              </div>
              <div className="unfinished__actions">
                <Link className="button button--quiet" href={`/record?project=${projectId}&date=${d}`}>Record it</Link>
              </div>
            </div>
          ))}
          {unfinished.map((d) => (
            <div key={d.id} className="unfinished__row">
              <div>
                <p className="mono unfinished__date">{fmtDate(d.date)}</p>
                <p className="unfinished__what">
                  {d.correctionOf ? `Correction to ${d.correctionOf} · ` : ''}
                  {d.labour > 0 ? `${d.labour} on labour` : 'no labour yet'}
                  {d.words ? ' · recording made' : ''}
                  {!d.mine ? ' · started by someone else' : ''}
                </p>
              </div>
              {d.mine ? (
                <div className="unfinished__actions">
                  <Link className="button button--quiet" href={`/entries/${d.id}/review`}>Finish</Link>
                  <button type="button" className="quotebtn quotebtn--remove" disabled={binning === d.id} onClick={() => void binDraft(d.id)}>
                    {binning === d.id ? 'Binning…' : 'Bin'}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <p className="home-wx mono">
          {weather
            ? `${n(weather.temp_max, '°')} · ${n(weather.rainfall_mm, '')} mm since 9am · ${weather.wind_dir ?? '—'} ${n(weather.wind_kmh, '', 0)} km/h${
                weather.source === 'manual' ? ' · entered by hand' : weather.station_name ? ` · ${weather.station_name}` : ''
              }`
            : 'No weather reading yet today'}
          {' · '}
          <Link className="linklike" href={`/reports/weekly?project=${projectId}`}>this week</Link>
        </p>
      )}
      {weatherNote && <p className="notice gap">{weatherNote}</p>}
      <ReminderToggle />
    </section>
  );
}
