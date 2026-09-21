import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { KIND_LABEL, KIND_LONG, RISK_LABEL, hrcwLabel, type SwmsKind, type SwmsStep } from './model';

/**
 * The method statement as a document, with everyone who signed on to this
 * version. Same dress and archival rules as the prestart: embedded fonts,
 * embedded frog, embedded ink.
 */
export interface SwmsPdfData {
  orgName: string;
  orgCode: string;
  projectName: string;
  projectCode: string;
  kind: SwmsKind;
  title: string;
  version: number;
  status: string;
  activity: string | null;
  hrcw: string[];
  ppe: string[];
  permits: string | null;
  plant: string | null;
  legislation: string | null;
  prepared_by: string | null;
  reviewed_by: string | null;
  activatedAwst: string | null;
  steps: SwmsStep[];
  /** The filed document, when the SWMS was uploaded rather than written (README R89): this print is its sign-on register. */
  filed: { name: string } | null;
  signons: Array<{ name: string; src: string; date: string }>;
  printedAwst: string;
}

export function SwmsDoc({ data }: { data: SwmsPdfData }): ReactElement {
  return (
    <div className="docket swms-doc">
      <header className="head">
        <div className="head__left">
          <p className="lbl"><img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}</p>
          <h1>{KIND_LONG[data.kind]}</h1>
          <p className="mono sub">{data.projectName} · {data.orgCode}_{data.projectCode}</p>
        </div>
        <div className="head__right">
          <p className="lbl">{KIND_LABEL[data.kind]} · version {data.version}</p>
          <p className="mono small">{data.status === 'active' ? `In use since ${data.activatedAwst ?? '—'}` : data.status}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">Task</p>
        <p className="swms-doc__title">{data.title}</p>
        {data.activity && <p>{data.activity}</p>}
      </section>

      {data.filed && (
        <section className="sect">
          <p className="lbl">The method statement</p>
          <p>{data.filed.name}</p>
          <p className="src">Filed as a document rather than written here. It is the method statement the crew read and signed on to; this sheet is the register of who did.</p>
        </section>
      )}

      {!data.filed && data.kind === 'swms' && (
        <section className="sect">
          <p className="lbl">High-risk construction work (WHS Regulations r.291)</p>
          {data.hrcw.length === 0 ? <p className="nil">None named</p> : <ul>{data.hrcw.map((k) => <li key={k}>{hrcwLabel(k)}</li>)}</ul>}
        </section>
      )}

      {!data.filed && <section className="sect">
        <p className="lbl">Steps, hazards and controls</p>
        <table>
          <thead>
            <tr>
              <th className="k">#</th>
              <th className="w">Step</th>
              <th className="w">Hazards</th>
              <th>Before</th>
              <th className="w">Controls</th>
              <th>After</th>
              <th>Who</th>
            </tr>
          </thead>
          <tbody>
            {data.steps.map((s, i) => (
              <tr key={i}>
                <td className="k mono">{i + 1}</td>
                <td className="w">{s.step}</td>
                <td className="w">{s.hazards}</td>
                <td>{s.risk_before ? RISK_LABEL[s.risk_before] : '—'}</td>
                <td className="w">{s.controls}</td>
                <td>{s.risk_after ? RISK_LABEL[s.risk_after] : '—'}</td>
                <td>{s.who ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>}

      {!data.filed && <section className="sect">
        <div className="grid-2">
          <div>
            <p className="lbl">PPE</p>
            <p>{data.ppe.length ? data.ppe.join(', ') : '—'}</p>
            <p className="lbl">Permits</p>
            <p>{data.permits ?? '—'}</p>
          </div>
          <div>
            <p className="lbl">Plant and equipment</p>
            <p>{data.plant ?? '—'}</p>
            <p className="lbl">Legislation, codes and standards</p>
            <p>{data.legislation ?? '—'}</p>
          </div>
        </div>
        <p className="src">Prepared by {data.prepared_by ?? '—'}{data.reviewed_by ? ` · reviewed by ${data.reviewed_by}` : ''}.</p>
      </section>}

      <section className="sect sig">
        <p className="lbl">Signed on to version {data.version} — “I have read and understood this and will work to it”</p>
        {data.signons.length === 0 ? (
          <p className="nil">Nobody has signed on to this version</p>
        ) : (
          <div className="swms-doc__signons">
            {data.signons.map((s, i) => (
              <figure key={i} className="swms-doc__signon">
                <img src={s.src} alt="" />
                <figcaption>{s.name}<span className="mono"> · {fmtDate(s.date)}</span></figcaption>
              </figure>
            ))}
          </div>
        )}
        <p className="src">Printed {data.printedAwst}. A person signs on once per version; a revision is a new version and a new sign-on.</p>
      </section>
    </div>
  );
}

export const SWMS_CSS = `
.swms-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.swms-doc__title { font-size: 12pt; font-weight: 700; margin: 1mm 0; }
.swms-doc__signons { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm; margin-top: 2mm; }
.swms-doc__signon { margin: 0; break-inside: avoid; }
.swms-doc__signon img { display: block; width: 100%; height: 18mm; object-fit: contain; border: 0.5pt solid #C9CCC7; border-radius: 1.5mm; background: #fff; }
.swms-doc__signon figcaption { margin-top: 1mm; font-size: 8pt; }
`;
