import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import type { WeeklyData } from './load';

/**
 * The weekly report template (brief §6) — one template for screen and print,
 * same rule as the daily docket.
 *
 * The AI narrative renders ABOVE the tables, in a visibly different dress:
 * tinted panel, amber rule, and a label that says exactly what it is. Nothing
 * in the ruled tables below it is model-written.
 */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 24" — hand-formatted from the ISO date, no locale in the render path. */
function dayLabel(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return date;
  const d = new Date(t);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

function money(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-AU')}`;
}

function Nil({ children }: { children: string }): ReactElement {
  return <p className="nil">{children}</p>;
}

export interface WeeklyReportProps {
  data: WeeklyData;
  narrative: string | null;
  /** Shown in place of the narrative when it is absent. */
  narrativeNote?: string;
}

export function WeeklyReport({ data, narrative, narrativeNote }: WeeklyReportProps): ReactElement {
  const { labour, plant, pours, quantities, delays, weather, variations } = data;

  return (
    <div className="docket weekly">
      <header className="head">
        <div>
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> Weekly site report
          </p>
          <h1>{data.project.name}</h1>
          <p className="sub">
            {data.project.orgCode}_{data.project.code} · {data.start} to {data.end}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">Entries covered</p>
          <p className="serial mono">{data.counts.entryCount}</p>
          <p className="sub">
            {data.counts.daysWithEntries} of {data.counts.daysInRange} days recorded
          </p>
        </div>
      </header>

      <section className="commentary">
        <p className="commentary__label">
          Commentary — AI-drafted summary. Not part of the signed record; the tables below
          are the record.
        </p>
        {narrative ? (
          <div className="commentary__body">
            {narrative.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        ) : (
          <p className="commentary__body commentary__none">
            {narrativeNote ?? 'No commentary was generated for this report.'}
          </p>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Labour hours</p>
        {labour.people.length === 0 ? (
          <Nil>No labour recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                {data.days.map((day) => (
                  <th key={day} className="n">
                    {dayLabel(day)}
                  </th>
                ))}
                <th className="n">OT</th>
                <th className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {labour.people.map((person) => (
                <tr key={person.name}>
                  <td className="k">{person.name}</td>
                  <td>{person.role ?? '—'}</td>
                  {data.days.map((day) => (
                    <td key={day} className="n mono">
                      {person.byDay[day] != null ? fmt(person.byDay[day]) : '·'}
                    </td>
                  ))}
                  <td className="n mono">{person.overtime > 0 ? fmt(person.overtime) : '·'}</td>
                  <td className="n mono">{fmt(person.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Daily totals</td>
                {data.days.map((day) => (
                  <td key={day} className="n mono">
                    {labour.dayTotals[day] != null ? fmt(labour.dayTotals[day]) : '·'}
                  </td>
                ))}
                <td className="n mono">{labour.overtimeTotal > 0 ? fmt(labour.overtimeTotal) : '·'}</td>
                <td className="n mono">{fmt(labour.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Work performed</p>
        {data.workItems.rows.length === 0 ? (
          <Nil>No work items recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Area</th>
                <th className="w">Description</th>
                <th className="n">% comp</th>
              </tr>
            </thead>
            <tbody>
              {data.workItems.rows.map((row, i) => (
                <tr key={i}>
                  <td className="k mono">{row.date}</td>
                  <td>{row.area ?? '—'}</td>
                  <td className="w">{row.description}</td>
                  <td className="n mono">
                    {row.percent_complete != null ? `${fmt(row.percent_complete)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Plant</p>
        {plant.rows.length === 0 ? (
          <Nil>No plant recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="w">Item</th>
                <th>Supplier</th>
                <th>Hire</th>
                <th className="n">Hours</th>
                <th className="n">Idle</th>
              </tr>
            </thead>
            <tbody>
              {plant.rows.map((row, i) => (
                <tr key={i}>
                  <td className="w">{row.item}</td>
                  <td>{row.supplier ?? '—'}</td>
                  <td>{row.hire_type ?? '—'}</td>
                  <td className="n mono">{fmt(row.hours)}</td>
                  <td className="n mono">{row.idle > 0 ? fmt(row.idle) : '·'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td className="n mono">{fmt(plant.totalHours)}</td>
                <td className="n mono">{plant.totalIdle > 0 ? fmt(plant.totalIdle) : '·'}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Pour schedule</p>
        {pours.rows.length === 0 ? (
          <Nil>No pours recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="w">Location</th>
                <th>Mix</th>
                <th>Supplier</th>
                <th className="n">m³</th>
                <th className="n">Cumulative m³</th>
              </tr>
            </thead>
            <tbody>
              {pours.rows.map((row, i) => (
                <tr key={i}>
                  <td className="k mono">{row.date}</td>
                  <td className="w">{row.location ?? '—'}</td>
                  <td>{row.mix_spec ?? '—'}</td>
                  <td>{row.supplier ?? '—'}</td>
                  <td className="n mono">{fmt(row.volume_m3)}</td>
                  <td className="n mono">{fmt(row.cumulative)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total volume</td>
                <td className="n mono">{fmt(pours.totalVolume)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Quantities</p>
        {quantities.rows.length === 0 ? (
          <Nil>No quantities recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="w">Item</th>
                <th>Date</th>
                <th>Area</th>
                <th className="n">Qty</th>
                <th>Unit</th>
                <th className="n">Running</th>
              </tr>
            </thead>
            <tbody>
              {quantities.rows.map((row, i) => (
                <tr key={i}>
                  <td className="w">{row.item_type}</td>
                  <td className="mono">{row.date}</td>
                  <td>{row.area ?? '—'}</td>
                  <td className="n mono">{fmt(row.quantity)}</td>
                  <td>{row.unit ?? '—'}</td>
                  <td className="n mono">{fmt(row.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Dayworks</p>
        {data.dayworks.rows.length === 0 ? (
          <Nil>No dayworks recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="w">Description</th>
                <th>Labour</th>
                <th>Plant</th>
                <th className="n">Hours</th>
                <th>Docket</th>
              </tr>
            </thead>
            <tbody>
              {data.dayworks.rows.map((row, i) => (
                <tr key={i}>
                  <td className="k mono">{row.date}</td>
                  <td className="w">{row.description}</td>
                  <td>{row.labour ?? '—'}</td>
                  <td>{row.plant ?? '—'}</td>
                  <td className="n mono">{fmt(row.hours)}</td>
                  <td className={row.docket_ref ? 'mono' : 'vr-missing'}>
                    {row.docket_ref ?? 'NO DOCKET'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total dayworks hours</td>
                <td className="n mono">{fmt(data.dayworks.totalHours)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Delays &amp; standdown</p>
        {delays.rows.length === 0 ? (
          <Nil>No delays recorded in this period</Nil>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="w">Cause</th>
                  <th>Category</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="n">Mins</th>
                  <th className="n">Crew</th>
                </tr>
              </thead>
              <tbody>
                {delays.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="k mono">{row.date}</td>
                    <td className="w">{row.cause}</td>
                    <td>{row.category ?? '—'}</td>
                    <td className="mono">{row.start_time ?? '—'}</td>
                    <td className="mono">{row.end_time ?? '—'}</td>
                    <td className="n mono">{fmt(row.duration_mins)}</td>
                    <td className="n mono">{fmt(row.personnel_affected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="subtable">
              <thead>
                <tr>
                  <th className="w">Hours lost by cause</th>
                  <th className="n">Minutes</th>
                  <th className="n">Hours</th>
                </tr>
              </thead>
              <tbody>
                {delays.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td className="w">{row.category}</td>
                    <td className="n mono">{fmt(row.minutes)}</td>
                    <td className="n mono">{fmt(row.hours)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total standdown</td>
                  <td className="n mono">{fmt(delays.totalMinutes)}</td>
                  <td className="n mono">{fmt(delays.totalHours)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Weather</p>
        {weather.rows.length === 0 ? (
          <Nil>No weather recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="n">Min °C</th>
                <th className="n">Max °C</th>
                <th className="n">Rain mm</th>
                <th>Wind</th>
                <th className="w">Observed impact</th>
              </tr>
            </thead>
            <tbody>
              {weather.rows.map((row) => (
                <tr key={row.date}>
                  <td className="k mono">{row.date}</td>
                  <td className="n mono">{fmt(row.temp_min)}</td>
                  <td className="n mono">{fmt(row.temp_max)}</td>
                  <td className="n mono">{fmt(row.rainfall_mm)}</td>
                  <td>
                    {row.wind_dir || row.wind_kmh != null
                      ? `${row.wind_dir ?? ''} ${row.wind_kmh != null ? `${fmt(row.wind_kmh)} km/h` : ''}`.trim()
                      : '—'}
                  </td>
                  <td className="w">{row.impact ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total rainfall</td>
                <td className="n mono">{fmt(weather.totalRainfallMm)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Variations raised</p>
        {variations.rows.length === 0 ? (
          <Nil>No variations recorded in this period</Nil>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="w">Description</th>
                <th>Directed by</th>
                <th>VR ref</th>
                <th className="n">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {variations.rows.map((row, i) => (
                <tr key={i}>
                  <td className="k mono">{row.date}</td>
                  <td className="w">{row.description}</td>
                  <td>{row.directed_by ?? '—'}</td>
                  <td className={row.referenced ? 'mono' : 'vr-missing'}>
                    {row.vr_ref ?? 'NO VR REF'}
                  </td>
                  <td className="n mono">{money(row.estimated_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Entries in this report</p>
        <p className="entries-line mono">
          {data.entries.map((e) => e.entry_no).join(' · ') || '—'}
        </p>
      </section>
    </div>
  );
}

/** Additions on top of DOCKET_CSS — the report reuses the docket's dress. */
export const WEEKLY_CSS = `
.commentary {
  margin-top: 5mm;
  padding: 3mm 3.5mm;
  background: #FBF6EA;
  border-left: 2.5pt solid #A8730A;
}
.commentary__label {
  margin: 0;
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-weight: 600;
  font-size: 7.5pt;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #A8730A;
}
.commentary__body { margin-top: 1.5mm; font-size: 9.5pt; line-height: 1.55; }
.commentary__body p { margin: 0 0 2mm; }
.commentary__body p:last-child { margin-bottom: 0; }
.commentary__none { color: #5A6469; }
.subtable { margin-top: 3mm; width: 60%; }
.vr-missing {
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-size: 8pt;
  letter-spacing: 0.06em;
  color: #A8730A;
  font-weight: 600;
  white-space: nowrap;
}
.entries-line { margin: 1mm 0 0; font-size: 8.5pt; color: #5A6469; }
.weekly th.n, .weekly td.n { padding-left: 3mm; }
@media screen and (max-width: 830px) {
  .subtable { width: 100%; }
}
`;
