import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import type { MonthData } from './bundle';

/**
 * The bundle's cover — the month's index. Serial, date, signatory and content
 * hash for every docket bound behind it, so the bundle carries its own
 * verification data: any single docket can be checked against this page.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthTitle(month: string): string {
  const [year, mm] = month.split('-').map(Number);
  return `${MONTH_NAMES[mm - 1]} ${year}`;
}

/** Hand-formatted UTC instant, same convention as the daily docket. */
function formatSigned(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  // AWST: fixed UTC+8, no daylight saving — arithmetic keeps it deterministic.
  const d = new Date(t + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} AWST`;
}

export function MonthlyCover({ data }: { data: MonthData }): ReactElement {
  return (
    <div className="docket">
      <header className="head">
        <div>
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> Monthly diary bundle
          </p>
          <h1>{data.project.name}</h1>
          <p className="sub">
            {data.project.orgCode}_{data.project.code} · {monthTitle(data.month)}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">Signed entries</p>
          <p className="serial mono">{data.entries.length}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">Contents</p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Signed by</th>
              <th>Signed at</th>
              <th className="w">Content hash (SHA-256)</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="k mono">{entry.entry_date}</td>
                <td className="k mono">
                  {entry.entry_no}
                  {entry.superseded_by && (
                    <span className="superseded"> · superseded by {entry.superseded_by}</span>
                  )}
                </td>
                <td>{entry.author_name}</td>
                <td className="mono">{formatSigned(entry.signed_at)}</td>
                <td className="w hashcell mono">{entry.content_hash ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="bundle-note">
        Each docket bound behind this page is the deterministic render of its signed entry.
        A docket&apos;s integrity can be verified against the content hash above.
        Entries marked superseded remain part of the record; their correction is bound
        alongside them.
      </p>
    </div>
  );
}

export const COVER_CSS = `
.hashcell { font-size: 6.5pt; word-break: break-all; color: #5A6469; }
.superseded {
  font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
  font-size: 7.5pt;
  color: #A8730A;
  letter-spacing: 0.05em;
}
.bundle-note { margin-top: 6mm; font-size: 8.5pt; color: #5A6469; line-height: 1.5; }
`;
