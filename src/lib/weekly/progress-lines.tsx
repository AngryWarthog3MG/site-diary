import type { ReactElement } from 'react';
import { PROGRESS_PALETTE, type ProgressSeries } from './progress-series';
export { buildProgressSeries, MAX_SERIES, PROGRESS_PALETTE } from './progress-series';
export type { ProgressPoint, ProgressSeries } from './progress-series';

/**
 * Percent complete by area across the week, as a line per area.
 *
 * Plain SVG built from the rows — no library, no script — so the same
 * markup renders on screen and in the PDF and comes out byte-identical
 * each time. Only stated percentages are plotted: a day nobody gave a
 * figure for has no point. The line between two stated points is the one
 * inference a line chart makes, and the Progress screen makes it too.
 */

const W = 560;
const H = 170;
const PAD = { top: 10, right: 14, bottom: 26, left: 34 };

export function ProgressLines({
  series,
  days,
}: {
  series: ProgressSeries[];
  days: string[];
}): ReactElement | null {
  if (series.length === 0 || days.length === 0) return null;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (date: string) => {
    const i = Math.max(0, days.indexOf(date));
    return PAD.left + (days.length === 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  };
  const y = (pct: number) => PAD.top + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;
  const dayLabel = (d: string) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}`;

  return (
    <figure className="proglines">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Percent complete by area across the week">
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(pct)} y2={y(pct)} stroke="#E4E7E5" strokeWidth={0.8} />
            <text x={PAD.left - 6} y={y(pct) + 3} textAnchor="end" fontSize={8} fill="#5A6469" fontFamily="inherit">
              {pct}%
            </text>
          </g>
        ))}
        {days.map((d) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={8} fill="#5A6469" fontFamily="inherit">
            {dayLabel(d)}
          </text>
        ))}
        {series.map((s, i) => {
          const colour = PROGRESS_PALETTE[i % PROGRESS_PALETTE.length];
          const path = s.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${x(p.date).toFixed(1)} ${y(p.percent).toFixed(1)}`).join(' ');
          return (
            <g key={s.area}>
              {s.points.length > 1 && <path d={path} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {s.points.map((p) => (
                <circle key={p.date} cx={x(p.date)} cy={y(p.percent)} r={3} fill={colour} stroke="#fff" strokeWidth={1} />
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="proglines__legend">
        {series.map((s, i) => (
          <span key={s.area}>
            <i style={{ background: PROGRESS_PALETTE[i % PROGRESS_PALETTE.length] }} />
            {s.area} · {s.latest}%
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export const PROGRESS_LINES_CSS = `
.proglines { margin: 3mm 0 0; }
.proglines svg { display: block; width: 100%; height: auto; }
.proglines__legend { display: flex; flex-wrap: wrap; gap: 1.5mm 5mm; margin-top: 1.5mm; font-size: 8pt; color: #131A1E; }
.proglines__legend span { display: inline-flex; align-items: center; gap: 1.5mm; }
.proglines__legend i { display: inline-block; width: 3mm; height: 3mm; border-radius: 0.75mm; }
`;
