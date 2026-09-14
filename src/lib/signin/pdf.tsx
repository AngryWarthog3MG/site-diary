import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { KIND_LABEL, eventClock, hoursOnSite, splitDay, type SignInRow } from './register';

/**
 * The day's attendance register as a document: everyone who was on site,
 * when they arrived, when they left, whether they were inducted when they
 * signed in. Same dress as the docket; times by hand in AWST.
 */
export interface SignInPdfData {
  orgName: string;
  orgCode: string;
  projectName: string;
  projectCode: string;
  date: string;
  rows: SignInRow[];
  /** When the register was printed — data-derived by the caller. */
  printedAwst: string;
}

export function SignInDoc({ data }: { data: SignInPdfData }): ReactElement {
  const { onSite, left } = splitDay(data.rows);
  const all = [...left, ...onSite].sort((a, b) => a.signed_in_on_device_at.localeCompare(b.signed_in_on_device_at));
  const notInducted = all.filter((r) => r.inducted === false).length;
  return (
    <div className="docket signin-doc">
      <header className="head">
        <div className="head__left">
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}
          </p>
          <h1>Site attendance register</h1>
          <p className="mono sub">
            {data.projectName} · {data.orgCode}_{data.projectCode}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">Day</p>
          <p className="mono big">{fmtDate(data.date)}</p>
          <p className="mono small">{all.length} on site · {onSite.length} still on site when printed</p>
        </div>
      </header>

      <section className="sect">
        {all.length === 0 ? (
          <p className="nil">Nobody signed in on this day</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="w">Name</th>
                <th>Company</th>
                <th>Here as</th>
                <th>Inducted</th>
                <th className="n">In</th>
                <th className="n">Out</th>
                <th className="n">Hours</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => {
                const h = hoursOnSite(r);
                return (
                  <tr key={r.id}>
                    <td className="w">{r.person_name}</td>
                    <td>{r.company ?? '—'}</td>
                    <td>{KIND_LABEL[r.person_kind]}</td>
                    <td className={r.inducted === false ? 'vr-missing' : ''}>{r.inducted == null ? '—' : r.inducted ? 'Yes' : 'NO'}</td>
                    <td className="n mono">{eventClock(r.signed_in_on_device_at, r.signed_in_at)}</td>
                    <td className="n mono">{r.signed_out_at ? eventClock(r.signed_out_on_device_at, r.signed_out_at) : 'on site'}</td>
                    <td className="n mono">{h == null ? '—' : h.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {notInducted > 0 && (
          <p className="src">
            {notInducted} {notInducted === 1 ? 'person was' : 'people were'} not recorded as inducted on this job when they signed in.
          </p>
        )}
        <p className="src">
          Times are Australian Western Standard Time from the phone at the gate; where the record reached the
          server later, the sending time is shown in brackets. Printed {data.printedAwst}.
        </p>
      </section>
    </div>
  );
}

export const SIGNIN_CSS = `
.signin-doc .head__right .big { font-size: 13pt; font-weight: 700; margin: 0.5mm 0 0; }
.signin-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.signin-doc td.vr-missing { color: #9A2B2B; font-weight: 700; }
`;
