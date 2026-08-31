'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { EntrySection } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { detectSections } from '@/lib/capture/sections';
import { localDate } from '@/lib/capture/queue';
import * as sync from '@/lib/capture/sync';
import { SectionChips } from '@/components/section-chips';
import { QueueStatus } from '@/components/queue-status';
import { ReminderToggle } from '@/components/reminder-toggle';

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
  lastSigned,
}: {
  projectId: string;
  canRecord: boolean;
  lastSigned: { entry_no: string | null; entry_date: string } | null;
}) {
  const [date, setDate] = useState('');
  const [entry, setEntry] = useState<TodayEntry | null>(null);
  const [weather, setWeather] = useState<WeatherRow | null>(null);
  const [weatherNote, setWeatherNote] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [week, setWeek] = useState<Array<{ date: string; label: string; state: string }>>([]);
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
        const sinceStr = since.toISOString().slice(0, 10);
        const { data: recent } = await supabase
          .from('entries')
          .select('entry_date, status')
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
          const byDate = new Map<string, string>();
          for (const row of recent ?? []) {
            const date = row.entry_date as string;
            const status = row.status as string;
            if (status === 'signed' || !byDate.has(date)) byDate.set(date, status);
          }
          const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
          const strip: Array<{ date: string; label: string; state: string }> = [];
          const cursor = new Date(`${today}T00:00:00`);
          cursor.setDate(cursor.getDate() - 6);
          for (let i = 0; i < 7; i += 1) {
            const date = cursor.toISOString().slice(0, 10);
            const status = byDate.get(date);
            strip.push({
              date,
              label: DOW[cursor.getDay()],
              state:
                status === 'signed'
                  ? 'signed'
                  : status
                    ? 'draft'
                    : date === today
                      ? 'today'
                      : 'gap',
            });
            cursor.setDate(cursor.getDate() + 1);
          }
          setWeek(strip);
        }

        if (first) {
          const have = new Set((recent ?? []).map((r) => r.entry_date as string));
          const gaps: string[] = [];
          const cursor = new Date(`${today}T00:00:00`);
          cursor.setDate(cursor.getDate() - 1);
          for (let i = 0; i < 7; i += 1) {
            const day = cursor.toISOString().slice(0, 10);
            if (day < (first.entry_date as string)) break;
            if (!have.has(day)) gaps.push(day);
            cursor.setDate(cursor.getDate() - 1);
          }
          setMissingDays(gaps);
        }
      }

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

  const covered: Set<EntrySection> = detectSections(entry?.transcript_raw ?? '');

  return (
    <>
      <section className="home-grid" aria-label="Today">
        <div className="home-card home-card--weather">
          <div className="home-card__head">
            <div>
              <p className="label">Conditions</p>
              <h2 className="home-card__title">Weather on site</h2>
            </div>
          </div>
          <div className="stats">
            <div className="stat">
              <p className="label">Temp</p>
              <p className="mono stat__value">{weather ? n(weather.temp_max, '°') : '—'}</p>
              <p className="mono stat__sub">min {weather ? n(weather.temp_min, '°') : '—'}</p>
            </div>
            <div className="stat">
              <p className="label">Rain</p>
              <p className="mono stat__value">{weather ? n(weather.rainfall_mm, '') : '—'}</p>
              <p className="mono stat__sub">mm since 9am</p>
            </div>
            <div className="stat">
              <p className="label">Wind</p>
              <p className="mono stat__value">
                {weather?.wind_dir ?? '—'} {weather ? n(weather.wind_kmh, '', 0) : ''}
              </p>
              <p className="mono stat__sub">km/h</p>
            </div>
          </div>

          {weather?.station_name && (
            <p className="caption mono">
              {weather.source === 'manual'
                ? 'Entered by hand'
                : `${weather.station_name}${
                    weather.station_distance_km != null
                      ? ` · ${weather.station_distance_km.toFixed(1)} km from site`
                      : ''
                  } · Bureau of Meteorology`}
            </p>
          )}
          {weatherNote && <p className="notice gap">{weatherNote}</p>}

          {lastSigned && (
            <div className="factrow">
              <span className="label">Last signed</span>
              <span className="mono" style={{ fontSize: '0.875rem' }}>
                {lastSigned.entry_no} · {lastSigned.entry_date}
              </span>
            </div>
          )}
        </div>

        <div className="home-card home-card--capture">
      {week.length > 0 && (
        <div className="weekstrip" aria-label="This week">
          {week.map((day) => (
            <span
              key={day.date}
              className={`weekstrip__day weekstrip__day--${day.state}`}
              title={`${day.date} — ${day.state === 'signed' ? 'signed' : day.state === 'draft' ? 'draft' : day.state === 'today' ? 'today, not yet recorded' : 'no record'}`}
            >
              {day.label}
            </span>
          ))}
        </div>
      )}

      {missingDays.length > 0 && (
        <p className="notice gap">
          No record for {missingDays.length === 1 ? missingDays[0] : `${missingDays.length} recent day${missingDays.length === 1 ? '' : 's'} (${missingDays.slice(0, 3).join(', ')}${missingDays.length > 3 ? '…' : ''})`}.{' '}
          <Link href={`/record?project=${projectId}&date=${missingDays[0]}`} style={{ color: 'inherit', fontWeight: 600 }}>
            Record {missingDays[0]} now
          </Link>
          {' '}or see the register.
        </p>
      )}

      <div className="home-card__head">
        <div>
          <p className="label">Today · {date}</p>
          <h2 className="home-card__title">Capture progress</h2>
        </div>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <SectionChips covered={covered} />
      </div>

      {!loading && (
        <p style={{ marginTop: '0.75rem', color: 'var(--ink-60)', fontSize: '0.9375rem' }}>
          {offline
            ? 'Offline — showing what is on this phone.'
            : entry
              ? entry.status === 'signed'
                ? `Today's entry is signed — ${entry.entry_no ?? 'done'}.`
                : entry.awaitingTranscription > 0
                  ? `${entry.segments} recording${entry.segments === 1 ? '' : 's'} attached · ${entry.awaitingTranscription} still transcribing`
                  : entry.transcript_raw
                    ? `${entry.segments} recording${entry.segments === 1 ? '' : 's'} attached and transcribed`
                    : 'Draft open, nothing recorded yet'
              : 'Nothing recorded today.'}
        </p>
      )}

      <QueueStatus />

      <div className="home-actions">
      {entry?.status === 'signed' ? (
        <>
          <Link className="button" href={`/entries/${entry.id}/signed`}>
            View the signed entry
          </Link>
          {canRecord && (
            <Link className="button button--quiet" href={`/record?project=${projectId}`}>
              Record a correction
            </Link>
          )}
          <p style={{ marginTop: '0.625rem', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
            A signed entry is never edited. Anything recorded after signing becomes a
            correction — a new entry, with its own serial, that supersedes this one.
          </p>
        </>
      ) : canRecord ? (
        <Link className="button button--record" href={`/record?project=${projectId}`}>
          {entry?.segments ? 'Record more' : 'Record'}
        </Link>
      ) : (
        <p className="notice">
          You are on this project as a PM. Recording is done by the site supervisor.
        </p>
      )}
      </div>

      {canRecord && entry && entry.status !== 'signed' && (entry.hasProposal || entry.hasRecord) && (
        <Link className="button" href={`/entries/${entry.id}/review`}>
          {entry.hasRecord ? 'Back to review' : 'Review and sign'}
        </Link>
      )}

      <ReminderToggle />
        </div>
      </section>

      <nav className="toolbar" aria-label="Project">
        <Link href={`/entries?project=${projectId}`}>Entries &amp; PDFs</Link>
        <span aria-hidden>·</span>
        <Link href={`/reports/weekly?project=${projectId}`}>Weekly</Link>
        <span aria-hidden>·</span>
        <Link href={`/ask?project=${projectId}`}>Ask</Link>
        <span aria-hidden>·</span>
        <Link href={`/settings?project=${projectId}`}>Settings</Link>
        {canRecord && (
          <>
            <span aria-hidden>·</span>
            <Link href={`/settings/members?project=${projectId}`}>Members</Link>
            <span aria-hidden>·</span>
            <Link href={`/settings/vocabulary?project=${projectId}`}>Vocabulary</Link>
          </>
        )}
      </nav>
    </>
  );
}
