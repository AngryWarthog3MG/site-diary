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
  useEffect(() => setToday(localDate()), []);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--ink-40)' }}>Nothing recorded on this project yet.</p>;
  }
  if (!today) return null;

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
  for (const row of rows) {
    const list = byDate.get(row.entry_date) ?? [];
    list.push(row);
    byDate.set(row.entry_date, list);
  }

  return (
    <>
      {days.map((day) =>
        day.kind === 'gap' ? (
          <Link
            key={day.date}
            href={`/record?project=${projectId}&date=${day.date}`}
            className="register-row register-row--gap"
          >
            <div>
              <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 500 }}>
                No record — {day.date}
              </p>
              <p style={{ margin: '0.125rem 0 0', fontSize: '0.8125rem', opacity: 0.8 }}>
                {day.date === today ? 'Nothing yet today.' : 'This day is a hole in the diary.'}
              </p>
            </div>
            <span className="chip chip--gap">Record it</span>
          </Link>
        ) : (
          (byDate.get(day.date) ?? []).map((entry) => {
            const signed = entry.status === 'signed';
            const href = signed
              ? `/entries/${entry.id}/signed`
              : entry.mine
                ? `/entries/${entry.id}/review`
                : `/entries/${entry.id}/signed`;
            return (
              <Link key={entry.id} href={href} className="register-row">
                <div>
                  <p className="mono" style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 500 }}>
                    {entry.entry_no ?? 'DRAFT'}
                  </p>
                  <p style={{ margin: '0.125rem 0 0', color: 'var(--ink-60)', fontSize: '0.8125rem' }}>
                    {entry.entry_date} · {entry.authorName}
                    {entry.correction ? ' · correction' : ''}
                  </p>
                </div>
                <span className={`chip${signed ? ' chip--on' : ''}`}>
                  {signed ? 'Signed · PDF' : entry.mine ? 'Resume' : 'Draft'}
                </span>
              </Link>
            );
          })
        ),
      )}
    </>
  );
}

function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
