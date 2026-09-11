import Link from 'next/link';
import { fmtDate } from '@/lib/pdf/dates';
import type { DayNeighbours } from '@/lib/entries/neighbours';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${fmtDate(iso).slice(0, 5)}`;
}

/**
 * Back a day, forward a day — from any day's page.
 *
 * `target` says which view of the neighbour to open. 'day' is the day itself:
 * a signed day's record, or a draft's review screen (the signed page routes a
 * draft to whoever may edit it and to a read-only view for everyone else).
 * 'docket' stays on the docket view so a PM reading through the week does
 * not bounce between screens.
 */
export function DayNav({ neighbours, target }: { neighbours: DayNeighbours; target: 'day' | 'docket' }) {
  const { prev, next } = neighbours;
  if (!prev && !next) return null;
  const href = (id: string) => (target === 'docket' ? `/entries/${id}/docket` : `/entries/${id}/signed`);
  return (
    <nav className="daynav" aria-label="Other days">
      {prev ? (
        <Link className="daynav__link" href={href(prev.id)} rel="prev">
          <span aria-hidden="true">‹</span> {dayLabel(prev.entry_date)}
          {prev.status !== 'signed' && <span className="daynav__draft">draft</span>}
        </Link>
      ) : (
        <span className="daynav__link daynav__link--none">First day</span>
      )}
      {next ? (
        <Link className="daynav__link daynav__link--next" href={href(next.id)} rel="next">
          {next.status !== 'signed' && <span className="daynav__draft">draft</span>}
          {dayLabel(next.entry_date)} <span aria-hidden="true">›</span>
        </Link>
      ) : (
        <span className="daynav__link daynav__link--none daynav__link--next">Latest day</span>
      )}
    </nav>
  );
}
