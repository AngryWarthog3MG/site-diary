import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import type { StoredCheck } from './checklist';

/**
 * One machine, one morning, one page. The checks print exactly as they were
 * answered — OK, Defect or N/A — with the defect notes and photos under them
 * and the operator's signature at the foot. Fit for use, or not, in the head
 * where an inspector looks first.
 */
export interface PlantPrestartPdfData {
  orgName: string;
  orgCode: string;
  projectName: string;
  projectCode: string;
  date: string;
  plantName: string;
  plantMeta: string;
  operator: string;
  hourMeter: number | null;
  checks: StoredCheck[];
  defects: Array<{ label: string; note: string | null; src: string | null }>;
  fitForUse: boolean;
  notes: string | null;
  completedAtAwst: string;
  signatureSrc: string | null;
}

export function PlantPrestartDoc({ data }: { data: PlantPrestartPdfData }): ReactElement {
  const defects = data.checks.filter((c) => c.result === 'defect').length;
  return (
    <div className="docket">
      <header className="head">
        <div className="head__left">
          <p className="lbl">
            <img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}
          </p>
          <h1>Plant prestart</h1>
          <p className="mono sub">
            {data.projectName} · {data.orgCode}_{data.projectCode}
          </p>
        </div>
        <div className="head__right">
          <p className="lbl">{data.plantName}</p>
          <p className="mono serial">{fmtDate(data.date)}</p>
          <p className={`fitbadge ${data.fitForUse ? 'fitbadge--ok' : 'fitbadge--no'}`}>
            {data.fitForUse ? 'FIT FOR USE' : 'NOT TO BE USED'}
          </p>
        </div>
      </header>

      <section className="sect">
        <div className="plantmeta">
          <div><p className="lbl">Machine</p><p>{data.plantMeta || data.plantName}</p></div>
          <div><p className="lbl">Operator</p><p>{data.operator}</p></div>
          <div><p className="lbl">Hour meter</p><p className="mono">{data.hourMeter == null ? '—' : data.hourMeter.toFixed(1)}</p></div>
        </div>
      </section>

      <section className="sect">
        <p className="lbl">Checks · {data.checks.length} items{defects > 0 ? ` · ${defects} defect${defects === 1 ? '' : 's'}` : ' · no defects'}</p>
        <ul className="checks">
          {data.checks.map((item) => (
            <li key={item.key} className={item.result === 'ok' ? 'checks__yes' : item.result === 'defect' ? 'checks__no' : 'checks__na'}>
              <span className="checks__mark" aria-hidden />
              <span>{item.label}{item.result === 'na' ? ' — n/a' : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      {data.defects.length > 0 && (
        <section className="sect">
          <p className="lbl">Defects</p>
          {data.defects.map((d, i) => (
            <div key={i} className="defect-print">
              <p className="talkhead">{d.label}</p>
              {d.note && <p className="talkpara">{d.note}</p>}
              {d.src && <img className="defectphoto" src={d.src} alt="" />}
            </div>
          ))}
        </section>
      )}

      {data.notes && (
        <section className="sect">
          <p className="lbl">Notes</p>
          <p className="talkpara">{data.notes}</p>
        </section>
      )}

      <section className="sig">
        <p className="lbl">Operator&rsquo;s signature</p>
        <div className="talkgrid">
          <figure>
            {data.signatureSrc ? <img src={data.signatureSrc} alt="" /> : <div className="sigline" />}
            <figcaption>{data.operator}</figcaption>
          </figure>
        </div>
        <p className="src">
          Signed {data.completedAtAwst}. This is a frozen record: the checks, defects and
          signature above cannot be altered. Kooboolong Services Pty Ltd.
        </p>
      </section>
    </div>
  );
}

export const PLANT_CSS = `
.fitbadge { display: inline-block; margin-top: 1.5mm; padding: 1mm 2.5mm; border-radius: 1mm; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; }
.fitbadge--ok { background: #2E6B4F; color: #fff; }
.fitbadge--no { background: #9A2F2F; color: #fff; }
.plantmeta { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 4mm; font-size: 9.5pt; }
.plantmeta p { margin: 0; }
.plantmeta .lbl { margin-bottom: 0.8mm; }
.checks__na .checks__mark { border-color: #9AA5A2; background: repeating-linear-gradient(45deg, #fff 0 0.5mm, #C9D1CE 0.5mm 1mm); }
.checks__na span:last-child { color: #5B6664; }
.defect-print { margin: 0 0 3mm; break-inside: avoid; }
.defectphoto { display: block; max-width: 70mm; max-height: 50mm; margin-top: 1.5mm; border: 0.5pt solid #C9D1CE; }
.sigline { height: 14mm; border-bottom: 0.6pt solid #131A1E; }
`;
