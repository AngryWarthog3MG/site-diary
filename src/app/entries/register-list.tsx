'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { localDate } from '@/lib/capture/queue';

export interface RegisterRow {
  id: string;
  entry_no: string | null;
  entry_date: string;
  status: string;
  mine: boolean;
  authorName: string;
  correction: boolean;
  supersedes: string | null;
}

/**
 * The register, with its conscience.
 *
 * A diary's value collapses on the days nobody records, and those days are
 * invisible precisely because there is nothing to see. So the register shows
 * them: every date between the project's first entry and today with no entry
 * at all renders as an amber gap row, with a path to record for that day.
 *
 * Client-side because "today" is the device's day, not the server's.
 */
export function RegisterList({ rows, projectId }: { rows: RegisterRow[]; projectId: string }) {
  const [today, setToday] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showEarlier, setShowEarlier] = useState<Set<string>>(new Set());

  // One document per day. A signed entry that a later *signed* entry has
  // replaced is an earlier version of the same day, not a second document:
  // it is folded away under the current one, still there, still openable.
  const replaced = new Set(
    rows.filter((r) => r.status === 'signed' && r.supersedes).map((r) => r.supersedes as string),
  );
  useEffect(() => setToday(localDate()), []);

  if (rows.length === 0) {
    return (
      <section className="entries-empty">
        <p className="label">Register</p>
        <h2>No entries yet</h2>
        <p>Once a supervisor records and signs the first diary, it will appear here.</p>
      </section>
    );
  }
  if (!today) return null;

  // A filter, not a search engine: substring match on reference, date and
  // author. While filtering, gap rows stand down — the person is looking for
  // an entry, not for holes.
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? rows.filter((row) =>
        [row.entry_no ?? '', row.entry_date, row.authorName]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : rows;
  const visibleRows = matches;

  const covered = new Set(rows.map((r) => r.entry_date));
  const oldest = rows[rows.length - 1].entry_date;

  // Newest first: walk from today back to the first entry, interleaving.
  const days: Array<{ kind: 'gap'; date: string } | { kind: 'entries'; date: string }> = [];
  for (
    let d = new Date(`${today}T00:00:00`);
    fmt(d) >= oldest && days.length < 400;
    d.setDate(d.getDate() - 1)
  ) {
    const date = fmt(d);
    days.push(covered.has(date) ? { kind: 'entries', date } : { kind: 'gap', date });
  }

  const byDate = new Map<string, RegisterRow[]>();
  for (const row of visibleRows) {
    const list = byDate.get(row.entry_date) ?? [];
    list.push(row);
    byDate.set(row.entry_date, list);
  }

  const visibleDays = needle
    ? days.filter((day) => day.kind === 'entries' && (byDate.get(day.date)?.length ?? 0) > 0)
    : days;

  return (
    <section className="entries-timeline" aria-label="Entry register">
      <div className="register-search">
        <input
          className="field field--sm"
          type="search"
          placeholder="Find an entry — reference, date or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter the register"
        />
        {needle && (
          <p className="register-search__count">
            {matches.length} match{matches.length === 1 ? '' : 'es'}
          </p>
        )}
      </div>
      {visibleDays.map((day) => {
        const entries = day.kind === 'entries' ? byDate.get(day.date) ?? [] : [];
        return (
          <section key={day.date} className="entries-day">
            <div className="entries-date">
              <p className="mono entries-date__day">{day.date.slice(8, 10)}</p>
              <div>
                <p className="label">{dateLabel(day.date, today)}</p>
                <p className="mono entries-date__full">{day.date}</p>
              </div>
            </div>

            <div className="entries-day__body">
              {day.kind === 'gap' ? (
                <Link
                  href={`/record?project=${projectId}&date=${day.date}`}
                  className="register-card register-card--gap"
                >
                  <div>
                    <p className="register-card__title">No record</p>
                    <p className="register-card__meta">
                      {day.date === today ? 'Nothing yet today.' : 'This day is a hole in the diary.'}
                    </p>
                  </div>
                  <span className="status-pill status-pill--gap">Record it</span>
                </Link>
              ) : (
                <>
                {(() => {
                  const earlier = entries.filter((e) => replaced.has(e.id));
                  const current = entries.filter((e) => !replaced.has(e.id));
                  const open = showEarlier.has(day.date);
                  return (
                    <>
                      {current.map((entry) => renderCard(entry, earlier.length))}
                      {earlier.length > 0 && (
                        <button
                          type="button"
                          className="register-earlier"
                          onClick={() =>
                            setShowEarlier((prev) => {
                              const next = new Set(prev);
                              if (next.has(day.date)) next.delete(day.date); else next.add(day.date);
                              return next;
                            })
                          }
                        >
                          {open ? 'Hide' : 'Show'} {earlier.length} earlier version{earlier.length === 1 ? '' : 's'} of this day
                        </button>
                      )}
                      {open && earlier.map((entry) => renderCard(entry, 0, true))}
                    </>
                  );
                })()}
                </>
              )}
            </div>
          </section>
        );
      })}
    </section>
  );

  function renderCard(entry: RegisterRow, earlierCount: number, isEarlier = false) {
                {
                  const signed = entry.status === 'signed';
                  const href = signed
                    ? `/entries/${entry.id}/signed`
                    : entry.mine
                      ? `/entries/${entry.id}/review`
                      : `/entries/${entry.id}/signed`;
                  return (
                    <Link key={entry.id} href={href} className={`register-card${isEarlier ? ' register-card--earlier' : ''}`}>
                      <div className="register-card__main">
                        <p className="mono register-card__title">{entry.entry_no ?? 'DRAFT'}</p>
                        <p className="register-card__meta">
                          {entry.authorName}
                          {isEarlier
                            ? ' · earlier version, replaced'
                            : !signed && entry.correction
                              ? ' · unsigned correction — the signed day stands until this is signed'
                              : signed && earlierCount > 0
                                ? ` · current version (${earlierCount} earlier)`
                                : ''}
                        </p>
                      </div>
                      <div className="register-card__actions">
                        {isEarlier && (
                          <span className="status-pill status-pill--correction">Replaced</span>
                        )}
                        <span
                          className={`status-pill${
                            signed
                              ? ' status-pill--signed'
                              : entry.mine
                                ? ' status-pill--resume'
                                : ' status-pill--draft'
                          }`}
                        >
                          {signed ? 'Signed PDF' : entry.mine ? 'Resume draft' : 'Draft'}
                        </span>
                      </div>
                    </Link>
                  );
                }
  }
}

function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === fmt(yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00`));
}
