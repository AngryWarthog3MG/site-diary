'use client';

import Link from 'next/link';
import { useState } from 'react';
import { monthLabel, monthOf, monthTiles, nextMonth, prevMonth, summariseMonth, type CalendarRow, type DayState } from '@/lib/entries/calendar-month';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WORD: Record<DayState, string> = { signed: 'Signed', draft: 'Draft', ready: 'Ready to sign', correction: 'Correction', gap: 'No record', rest: 'Rest', future: '', before: '' };

/**
 * The diary as a month (README R131): a tile a day, coloured by what the record holds, and a tap opens the day. The
 * list below is unchanged — this is the same register seen from above, with the holes where they fall.
 */
export function DiaryCalendar({ rows, projectId, today }: { rows: CalendarRow[]; projectId: string; today: string }) {
  const [month, setMonth] = useState(monthOf(today));
  const weeks = monthTiles(rows, month, today);
  const sum = summariseMonth(weeks);
  const thisMonth = monthOf(today);
  const hrefFor = (t: (typeof weeks)[number][number]) => {
    if (t.entryId) return `/entries/${t.entryId}/${t.state === 'signed' ? 'signed' : 'review'}`;
    if (t.state === 'gap' || t.state === 'rest') return `/record?project=${projectId}&date=${t.date}`;
    return null;
  };
  return (
    <section className="diarycal" aria-label="The month at a glance">
      <div className="diarycal__head">
        <button type="button" className="chip chip--link" onClick={() => setMonth(prevMonth(month))} aria-label="Month before">‹ {monthLabel(prevMonth(month)).split(' ')[0]}</button>
        <h2 className="diarycal__title">{monthLabel(month)}</h2>
        <div className="diarycal__nav">
          {month !== thisMonth && <button type="button" className="chip chip--link" onClick={() => setMonth(thisMonth)}>This month</button>}
          <button type="button" className="chip chip--link" onClick={() => setMonth(nextMonth(month))} aria-label="Month after" disabled={month >= thisMonth}>{monthLabel(nextMonth(month)).split(' ')[0]} ›</button>
        </div>
      </div>
      <p className="caption diarycal__sum">
        {sum.signed} signed · {sum.drafts} draft{sum.drafts === 1 ? '' : 's'}{sum.ready ? ` (${sum.ready} ready to sign)` : ''} · {sum.corrections} correction{sum.corrections === 1 ? '' : 's'} · {sum.gaps} working day{sum.gaps === 1 ? '' : 's'} with no record
      </p>
      <div className="diarycal__grid" role="grid">
        {DAYS.map((d) => <div key={d} className="diarycal__dow" role="columnheader">{d}</div>)}
        {weeks.flat().map((t) => {
          const href = hrefFor(t);
          const cls = `diarycal__day diarycal__day--${t.state}${t.inMonth ? '' : ' diarycal__day--out'}${t.today ? ' diarycal__day--today' : ''}`;
          const body = (
            <>
              <span className="diarycal__num">{Number(t.date.slice(8, 10))}</span>
              {t.inMonth && WORD[t.state] && <span className="diarycal__word">{WORD[t.state]}</span>}
              {t.inMonth && t.state === 'signed' && t.entryNo && <span className="diarycal__no mono">{t.entryNo.replace(/^.*?-(\d{4}-\d{2}-\d{2})/, '$1').slice(-5)}</span>}
            </>
          );
          const title = `${t.date}${WORD[t.state] ? ` · ${WORD[t.state]}` : ''}`;
          return href
            ? <Link key={t.date} href={href} className={cls} role="gridcell" title={title} aria-label={title}>{body}</Link>
            : <div key={t.date} className={cls} role="gridcell" title={title}>{body}</div>;
        })}
      </div>
      <p className="caption diarycal__key">
        <span className="diarycal__swatch diarycal__swatch--signed" /> signed
        <span className="diarycal__swatch diarycal__swatch--draft" /> draft
        <span className="diarycal__swatch diarycal__swatch--ready" /> ready to sign
        <span className="diarycal__swatch diarycal__swatch--correction" /> correction open
        <span className="diarycal__swatch diarycal__swatch--gap" /> no record
        <span className="diarycal__swatch diarycal__swatch--rest" /> rest day
      </p>
    </section>
  );
}
