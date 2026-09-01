'use client';

import { useMemo, useRef, useState } from 'react';
import type { AreaSeries } from '@/lib/progress/load';

/**
 * Percent-complete over time, one line per area.
 *
 * Built to the dataviz method: a validated five-hue categorical palette in
 * fixed order (hue follows the area, never its rank), 2px lines with 8px
 * markers, recessive grid, one axis, legend plus direct end-labels, text in
 * ink tokens, and a crosshair tooltip on hover. The table below the chart is
 * the accessible view of the same numbers.
 */

// Validated (six checks, light surface #fdfdfc): fixed order, never cycled.
const PALETTE = ['#2e7d43', '#2f6fb0', '#b07d1a', '#c04a7c', '#6d4fc2'];

const W = 720;
const H = 320;
const PAD = { top: 16, right: 120, bottom: 34, left: 40 };

export function ProgressChart({ series, dates }: { series: AreaSeries[]; dates: string[] }) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    area: string;
    date: string;
    percent: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const domain = useMemo(() => {
    const first = dates[0];
    const last = dates[dates.length - 1];
    const t0 = Date.parse(`${first}T00:00:00Z`);
    const t1 = Math.max(Date.parse(`${last}T00:00:00Z`), t0 + 86_400_000);
    return { t0, t1 };
  }, [dates]);

  const x = (date: string) =>
    PAD.left +
    ((Date.parse(`${date}T00:00:00Z`) - domain.t0) / (domain.t1 - domain.t0)) *
      (W - PAD.left - PAD.right);
  const y = (percent: number) => PAD.top + (1 - percent / 100) * (H - PAD.top - PAD.bottom);

  const flat = useMemo(
    () =>
      series.flatMap((s, index) =>
        s.points.map((p) => ({ ...p, area: s.area, colour: PALETTE[index % PALETTE.length] })),
      ),
    [series],
  );

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || flat.length === 0) return;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const py = ((event.clientY - rect.top) / rect.height) * H;
    let best = flat[0];
    let bestDist = Infinity;
    for (const p of flat) {
      const d = (x(p.date) - px) ** 2 + (y(p.percent) - py) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (bestDist > 40 ** 2) {
      setHover(null);
      return;
    }
    setHover({ x: x(best.date), y: y(best.percent), area: best.area, date: best.date, percent: best.percent });
  }

  const tickDates = useMemo(() => {
    if (dates.length <= 4) return dates;
    const step = (dates.length - 1) / 3;
    return [0, 1, 2, 3].map((i) => dates[Math.round(i * step)]);
  }, [dates]);

  return (
    <div className="progress-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Percent complete over time by area"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Recessive grid: y only, quartiles. */}
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(p)}
              y2={y(p)}
              stroke="var(--ink-08)"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(p) + 4} textAnchor="end" className="progress-chart__tick">
              {p}%
            </text>
          </g>
        ))}
        {tickDates.map((d) => (
          <text key={d} x={x(d)} y={H - 10} textAnchor="middle" className="progress-chart__tick">
            {d.slice(5)}
          </text>
        ))}

        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--ink-30)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {series.map((s, index) => {
          const colour = PALETTE[index % PALETTE.length];
          const path = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.percent).toFixed(1)}`)
            .join(' ');
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.area}>
              <path d={path} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" />
              {s.points.map((p) => (
                <circle
                  key={p.date}
                  cx={x(p.date)}
                  cy={y(p.percent)}
                  r={4}
                  fill={colour}
                  stroke="var(--paper)"
                  strokeWidth={2}
                />
              ))}
              {/* Direct label at the line's end; identity, in ink. */}
              <text
                x={x(last.date) + 8}
                y={y(last.percent) + 4}
                className="progress-chart__label"
              >
                {s.area.length > 16 ? `${s.area.slice(0, 15)}…` : s.area}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          className="progress-chart__tip"
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
        >
          <strong>{hover.area}</strong> · {hover.date} · {hover.percent}%
        </div>
      )}

      <ul className="progress-chart__legend">
        {series.map((s, index) => (
          <li key={s.area}>
            <span
              className="progress-chart__swatch"
              style={{ background: PALETTE[index % PALETTE.length] }}
            />
            {s.area}
          </li>
        ))}
      </ul>
    </div>
  );
}
