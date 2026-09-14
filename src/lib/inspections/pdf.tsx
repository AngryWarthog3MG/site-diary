import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { KIND_LABEL, RESULT_LABEL, type InspectionItem, type InspectionKind } from './model';

export interface InspectionPdfData {
  orgName: string; orgCode: string; projectName: string; projectCode: string;
  template_name: string; kind: InspectionKind; date: string; area: string | null; inspector: string;
  items: Array<InspectionItem & { photos: Array<{ src: string }> }>;
  summary: string | null; completedAwst: string;
  actions: Array<{ item_key: string | null; action: string; owner: string | null; due: string | null; done_at: string | null; done_note: string | null }>;
  signature: string | null; printedAwst: string;
}

export function InspectionDoc({ data }: { data: InspectionPdfData }): ReactElement {
  const issues = data.items.filter((i) => i.result === 'issue');
  const withPhotos = data.items.filter((i) => i.photos.length > 0);
  return (
    <div className="docket inspection-doc">
      <header className="head">
        <div className="head__left">
          <p className="lbl"><img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}</p>
          <h1>{data.template_name}</h1>
          <p className="mono sub">{data.projectName} · {data.orgCode}_{data.projectCode}</p>
        </div>
        <div className="head__right">
          <p className="lbl">{KIND_LABEL[data.kind]}</p>
          <p className="mono big">{fmtDate(data.date)}</p>
          <p className="mono small">{data.area ?? 'Whole site'} · {data.inspector}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">Items</p>
        <table>
          <thead><tr><th className="w">Item</th><th>Result</th><th className="w">Note</th></tr></thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.key}>
                <td className="w">{i.label}</td>
                <td className={`mono${i.result === 'issue' ? ' vr-missing' : ''}`}>{i.result ? RESULT_LABEL[i.result] : 'NOT CHECKED'}</td>
                <td className="w">{i.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="src">{issues.length} issue{issues.length === 1 ? '' : 's'} of {data.items.length} items. {data.summary ?? ''}</p>
      </section>

      <section className="sect">
        <p className="lbl">Corrective actions</p>
        {data.actions.length === 0 ? <p className="nil">No corrective actions recorded</p> : (
          <table>
            <thead><tr><th className="w">Action</th><th>Item</th><th>Owner</th><th>Due</th><th>Done</th></tr></thead>
            <tbody>
              {data.actions.map((a, i) => (
                <tr key={i}>
                  <td className="w">{a.action}{a.done_note ? <span className="src"> — {a.done_note}</span> : null}</td>
                  <td>{a.item_key ? data.items.find((it) => it.key === a.item_key)?.label.slice(0, 30) ?? a.item_key : '—'}</td>
                  <td>{a.owner ?? '—'}</td>
                  <td className="mono">{a.due ? fmtDate(a.due) : '—'}</td>
                  <td className={`mono${a.done_at ? '' : ' vr-missing'}`}>{a.done_at ? fmtDate(a.done_at.slice(0, 10)) : 'OPEN'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sect sig">
        <p className="lbl">Signed</p>
        {data.signature ? (
          <div className="sig__drawn"><figure><img src={data.signature} alt="" style={{ height: '18mm' }} /><figcaption>{data.inspector} · {data.completedAwst}</figcaption></figure></div>
        ) : <p className="nil">Not signed</p>}
        <p className="src">Printed {data.printedAwst}. The items and answers are frozen at signing; actions are added afterwards.</p>
      </section>

      {withPhotos.length > 0 && (
        <section className="sect photos">
          <p className="lbl">Photographs</p>
          <div className="photos__grid">
            {withPhotos.flatMap((i) => i.photos.map((p, n) => (
              <figure key={`${i.key}-${n}`}><img src={p.src} alt="" data-shrink="1200" /><figcaption className="mono">{i.label.slice(0, 60)}</figcaption></figure>
            )))}
          </div>
        </section>
      )}
    </div>
  );
}

export const INSPECTION_CSS = `
.inspection-doc .head__right .big { font-size: 13pt; font-weight: 700; margin: 0.5mm 0 0; }
.inspection-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.inspection-doc td.vr-missing { color: #9A2B2B; font-weight: 700; }
`;
