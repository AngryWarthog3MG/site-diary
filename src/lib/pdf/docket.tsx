import { BOM_ATTRIBUTION } from '../weather/attribution';
import { LOGO_DATA_URI } from './logo';
import type { DocketEntry, Row } from './load';
import { formatInstant, num, text, timeOnly } from './load';

/**
 * The daily docket (brief §6).
 *
 * One template, rendered two ways: to HTML for Chromium to turn into the PDF,
 * and to the same markup on screen. §2 is explicit that these must not be two
 * templates that drift.
 *
 * Nothing here is AI-generated (§2.3). It renders stored structured fields and
 * only stored fields — no summary, no narrative, no `source_quote`, no
 * confidence flag. Those are extraction bookkeeping and the review screen's
 * business, not the record's.
 */

const SECTION_LABELS: Record<string, string> = {
  labour: 'Labour',
  plant: 'Plant',
  work_items: 'Works completed',
  variations: 'Variations',
  delays: 'Delays',
  weather: 'Weather',
};

export function DailyDocket({ entry, photos }: { entry: DocketEntry; photos: PhotoImage[] }) {
  const dayworks = entry.dayworks ?? [];
  return (
    <article className="docket">
      <Header entry={entry} />
      <WeatherBlock entry={entry} />

      <Table
        section="labour"
        entry={entry}
        rows={entry.labour}
        columns={[
          ['Name', (r) => text(r.person_name)],
          ['Role', (r) => text(r.role)],
          ['Area', (r) => text(r.area)],
          ['Times', (r) => workedSpan(r), 'k'],
          ['Hours', (r) => num(r.hours), 'n'],
          ['O/T', (r) => num(r.overtime_hours), 'n'],
        ]}
        total={['Total hours', totalOf(entry.labour, 2, 'hours', 'overtime_hours')]}
      />

      <Table
        section="plant"
        entry={entry}
        rows={entry.plant}
        columns={[
          ['Item', (r) => text(r.item)],
          ['Hire', (r) => text(r.hire_type), 'k'],
          ['Supplier', (r) => text(r.supplier)],
          ['Hours', (r) => num(r.hours), 'n'],
          ['Idle', (r) => num(r.idle_hours), 'n'],
        ]}
        total={['Total hours', totalOf(entry.plant, 2, 'hours')]}
      />

      <Table
        section="work_items"
        entry={entry}
        rows={entry.work_items}
        columns={[
          ['Area', (r) => text(r.area)],
          ['Description', (r) => text(r.description), 'w'],
          ['%', (r) => (r.percent_complete == null ? '—' : num(r.percent_complete, 0)), 'n'],
        ]}
      />

      <Table
        section="variations"
        entry={entry}
        rows={entry.variations}
        columns={[
          ['VR ref', (r) => text(r.vr_ref), 'k'],
          ['Description', (r) => text(r.description), 'w'],
          ['Directed by', (r) => text(r.directed_by)],
          ['Directed at', (r) => shortInstant(r.directed_at as string | null), 'k'],
          ['Est. cost', (r) => num(r.estimated_cost), 'n'],
          ['Photos', (r) => String(((r.photo_urls as string[] | null) ?? []).length), 'n'],
        ]}
      />

      <Table
        section="delays"
        entry={entry}
        rows={entry.delays}
        columns={[
          ['From', (r) => timeOnly(r.start_time), 'n'],
          ['To', (r) => timeOnly(r.end_time), 'n'],
          ['Mins', (r) => (r.duration_mins == null ? '—' : String(r.duration_mins)), 'n'],
          ['Cause', (r) => text(r.cause), 'w'],
          ['Category', (r) => text(r.category), 'k'],
          ['People', (r) => (r.personnel_affected == null ? '—' : String(r.personnel_affected)), 'n'],
        ]}
        total={['Total minutes', totalOf(entry.delays, 0, 'duration_mins')]}
      />

      {entry.pours.length > 0 && (
        <Table
          section={null}
          title="Concrete"
          entry={entry}
          rows={entry.pours}
          columns={[
            ['Location', (r) => text(r.location)],
            ['Volume m³', (r) => num(r.volume_m3), 'n'],
            ['Mix', (r) => text(r.mix_spec), 'k'],
            ['Supplier', (r) => text(r.supplier)],
            ['Start', (r) => timeOnly(r.start_time), 'n'],
            ['Finish', (r) => timeOnly(r.finish_time), 'n'],
            ['Dockets', (r) => joinList(r.docket_nos), 'k'],
          ]}
          total={['Total m³', totalOf(entry.pours, 2, 'volume_m3')]}
        />
      )}

      {dayworks.length > 0 && (
        <Table
          section={null}
          title="Dayworks"
          entry={entry}
          rows={dayworks}
          columns={[
            ['Description', (r) => text(r.description), 'w'],
            ['Docket / ref', (r) => text(r.docket_ref), 'k'],
            ['Hours', (r) => num(r.hours), 'n'],
            ['Labour', (r) => text(r.labour)],
            ['Plant', (r) => text(r.plant)],
            ['Materials', (r) => text(r.materials)],
            ['Photos', (r) => String(((r.photo_urls as string[] | null) ?? []).length), 'n'],
          ]}
          total={['Total hours', totalOf(dayworks, 2, 'hours')]}
        />
      )}

      {entry.quantities.length > 0 && (
        <Table
          section={null}
          title="Quantities"
          entry={entry}
          rows={entry.quantities}
          columns={[
            ['Item', (r) => text(r.item_type)],
            ['Area', (r) => text(r.area)],
            ['Quantity', (r) => num(r.quantity, 3), 'n'],
            ['Unit', (r) => text(r.unit), 'k'],
          ]}
        />
      )}

      {entry.notes && (
        <section className="sect">
          <p className="lbl">Additional notes</p>
          <p className="notes">{entry.notes}</p>
        </section>
      )}

      <Photos photos={photos} />
      <Signature entry={entry} />
    </article>
  );
}

export interface PhotoImage {
  /** data: URI. Embedded so the document does not depend on the bucket. */
  src: string;
  caption: string | null;
  context: string;
}

function Header({ entry }: { entry: DocketEntry }) {
  return (
    <header className="head">
      <div className="head__left">
        <p className="lbl">
          <img className="brandmark" src={LOGO_DATA_URI} alt="" /> {entry.org_name}
        </p>
        <h1>{entry.project_name}</h1>
        <p className="mono sub">
          {entry.org_code}_{entry.project_code}
          {entry.principal_contractor ? ` · ${entry.principal_contractor}` : ''}
        </p>
      </div>
      <div className="head__right">
        <p className="lbl">Daily diary</p>
        <p className="mono serial">{entry.entry_no ?? 'UNSIGNED DRAFT'}</p>
        <p className="mono sub">{entry.entry_date}</p>
      </div>
      {entry.supersedes_entry_no && (
        <p className="supersedes">
          Correction — supersedes {entry.supersedes_entry_no}
        </p>
      )}
    </header>
  );
}

function WeatherBlock({ entry }: { entry: DocketEntry }) {
  const w = entry.weather;
  return (
    <section className="weather">
      <p className="lbl">Weather</p>
      <div className="weather__grid mono">
        <span>Min {w ? num(w.temp_min, 1) : '—'}°</span>
        <span>Max {w ? num(w.temp_max, 1) : '—'}°</span>
        <span>Rain {w ? num(w.rainfall_mm, 1) : '—'} mm</span>
        <span>
          Wind {w ? text(w.wind_dir) : '—'} {w ? num(w.wind_kmh, 0) : '—'} km/h
        </span>
      </div>
      <p className="src">
        {w?.station_name
          ? `${String(w.station_name)}${
              w.station_distance_km != null ? ` · ${num(w.station_distance_km, 1)} km from site` : ''
            } · ${w.source === 'manual' ? 'entered on site' : BOM_ATTRIBUTION}`
          : 'No weather recorded'}
      </p>
      {w?.observed_impact ? <p className="impact">{String(w.observed_impact)}</p> : null}
    </section>
  );
}

/**
 * 'n' right-aligns a figure, 'k' keeps a short identifier on one line, 'w'
 * gives a description column the width it needs.
 */
type Column = [string, (row: Row) => string, ('n' | 'w' | 'k')?];

function Table({
  section,
  title,
  entry,
  rows,
  columns,
  total,
}: {
  section: string | null;
  title?: string;
  entry: DocketEntry;
  rows: Row[];
  columns: Column[];
  total?: [string, string | null];
}) {
  const state = section ? entry.sections[section]?.state : undefined;

  return (
    <section className="sect">
      <p className="lbl">{title ?? (section ? SECTION_LABELS[section] : '')}</p>

      {rows.length === 0 ? (
        <p className={`nil${state === 'nil_confirmed' ? '' : ' nil--gap'}`}>
          {state === 'nil_confirmed'
            ? 'NIL — confirmed by the supervisor'
            : 'NOT RECORDED — no answer given'}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              {columns.map(([label, , kind]) => (
                <th key={label} className={kind ?? ''}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map(([label, render, kind]) => (
                  <td key={label} className={kind === 'n' ? 'n mono' : (kind ?? '')}>
                    {render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total?.[1] ? (
            <tfoot>
              <tr>
                <td colSpan={columns.length - 1}>{total[0]}</td>
                <td className="n mono">{total[1]}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      )}
    </section>
  );
}

function Photos({ photos }: { photos: PhotoImage[] }) {
  if (photos.length === 0) return null;
  return (
    <section className="sect photos">
      <p className="lbl">Photographs</p>
      <div className="photos__grid">
        {photos.map((photo, index) => (
          <figure key={index}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.src} alt={photo.caption ?? photo.context} />
            <figcaption className="mono">
              {index + 1}. {photo.context}
              {photo.caption ? ` — ${photo.caption}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Signature({ entry }: { entry: DocketEntry }) {
  const signed = entry.status === 'signed';
  return (
    <section className="sig">
      <p className="lbl">{signed ? 'Signed' : 'Unsigned draft'}</p>
      {signed ? (
        <>
          <div className="sig__grid">
            <div>
              <p className="lbl">Signatory</p>
              <p>{entry.author_name}</p>
            </div>
            <div>
              <p className="lbl">Signed at</p>
              <p className="mono">{formatInstant(entry.signed_at)}</p>
            </div>
          </div>
          <p className="lbl" style={{ marginTop: '4mm' }}>
            Content hash · SHA-256
          </p>
          <p className="mono hash">{entry.content_hash}</p>
          <p className="src">
            This entry is immutable. Any change is recorded as a later entry that supersedes it. Verify this document at kbsdailydiary.me/verify
          </p>
        </>
      ) : (
        <p className="nil nil--gap">
          NOT SIGNED — this is a working draft and is not part of the record.
        </p>
      )}
    </section>
  );
}

/** "07:00–15:30 · 30m brk", or a dash when no clock was recorded. */
function workedSpan(r: Row): string {
  const start = timeOnly(r.start_time);
  const finish = timeOnly(r.finish_time);
  if (start === '—' && finish === '—') return '—';
  const brk =
    r.break_mins == null ? '' : r.break_mins === 0 ? ' · no brk' : ` · ${r.break_mins}m brk`;
  return `${start}–${finish}${brk}`;
}

function totalOf(rows: Row[], digits: number, ...keys: string[]): string | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (value == null) continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        total += parsed;
        seen = true;
      }
    }
  }
  return seen ? total.toFixed(digits) : null;
}

/** Date and time without seconds — the docket is short of width, not precision. */
function shortInstant(value: string | null): string {
  const full = formatInstant(value);
  return full === '—' ? full : full.replace(/:\d{2} AWST$/, ' AWST');
}

function joinList(value: unknown): string {
  const list = (value as string[] | null) ?? [];
  return list.length ? list.join(', ') : '—';
}
