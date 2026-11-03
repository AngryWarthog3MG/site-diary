'use client';

import { useMemo, useState } from 'react';
import { Fold } from '@/components/fold';
import { fmtDate } from '@/lib/pdf/dates';
import { filterMonths, monthLabel, type LibraryDay, type LibraryMonth } from '@/lib/photos/library';

/**
 * The finder over the job's photographs (README R183): a search box and one chip per kind, narrowing the library on
 * the phone as you type — by caption, by where it sits (a variation's number, a pour), by who added it, by the day
 * said any way. Nothing is fetched or stored; the page already holds the list and the hour's links.
 */
export function PhotoFinder({ months, kinds, urls, total, q }: {
  months: LibraryMonth[]; kinds: Array<{ kind: string; count: number }>; urls: Record<string, string>; total: number; q: string;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const narrowed = useMemo(() => filterMonths(months, query, kind), [months, query, kind]);
  const shown = narrowed.reduce((n, m) => n + m.count, 0);
  const searching = Boolean(query.trim()) || kind != null;

  const dayBlock = (day: LibraryDay) => (
    <section key={day.date} className="photolib-day" aria-label={`Photographs of ${fmtDate(day.date)}`}>
      <header className="photolib-day__head">
        <h3>{fmtDate(day.date)}</h3>
        <p className="photolib-day__meta mono">
          {day.day === 'signed' ? `${day.entryNo ?? 'Signed'} · signed` : day.day === 'draft' ? 'Draft, not yet signed' : 'No diary for this day'} · {day.photos.length} photo{day.photos.length === 1 ? '' : 's'}
        </p>
      </header>
      <div className="photolib-grid photo-zoom-gallery">
        {day.photos.map((p) => (
          <figure key={p.path} className="photolib-item">
            {urls[p.path] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[p.path]} alt={p.caption ?? p.context} loading="lazy" />
            ) : (
              <div className="photolib-item__missing">File not found</div>
            )}
            <figcaption>
              <span className="photolib-item__context">{p.context}{p.source === 'crew' ? ` · ${p.by ?? 'crew'}, not yet on the day` : p.day === 'signed' ? '' : ' · draft'}</span>
              {p.caption && <span className="photolib-item__caption">{p.caption}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );

  return (
    <>
      <div className="photolib-finder" role="search">
        <input
          className="field"
          type="search"
          inputMode="search"
          placeholder="Find a photograph — a word from its caption, a variation number, a day like 21 Oct, a name"
          aria-label="Find a photograph"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {kinds.length > 1 && (
          <nav className="chips chips--compact" aria-label="Kind of photograph">
            <button type="button" className={`chip${kind == null ? ' chip--on' : ''}`} onClick={() => setKind(null)}>All · {total}</button>
            {kinds.map((k) => (
              <button key={k.kind} type="button" className={`chip${kind === k.kind ? ' chip--on' : ''}`} onClick={() => setKind(kind === k.kind ? null : k.kind)}>{k.kind} · {k.count}</button>
            ))}
          </nav>
        )}
      </div>
      {searching && (
        <p className="review-muted" aria-live="polite">
          {shown === 0 ? 'No photograph matches that.' : `${shown} of ${total} photograph${total === 1 ? '' : 's'}${kind ? ` · ${kind}` : ''}${query.trim() ? ` · “${query.trim()}”` : ''}.`}
          {' '}<button type="button" className="linklike" onClick={() => { setQuery(''); setKind(null); }}>Show all</button>
        </p>
      )}
      {narrowed.map((m, i) => (
        <section key={m.month} className="photolib-month">
          <header className="photolib-month__head">
            <h2>{monthLabel(m.month)}</h2>
            {!searching && <a className="button button--quiet" href={`/api/entries/photos/zip?${q}&month=${m.month}`} download>Download {monthLabel(m.month)} · {m.count}</a>}
          </header>
          {i === 0 || searching ? m.days.map(dayBlock) : (
            <Fold label={`${m.days.length} day${m.days.length === 1 ? '' : 's'}`} count={m.count}>
              {m.days.map(dayBlock)}
            </Fold>
          )}
        </section>
      ))}
    </>
  );
}
