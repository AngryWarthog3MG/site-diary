import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { KIND_LABEL, STATUS_LABEL, permitRef, type Control, type PermitKind, type PermitStatus } from './model';

export interface PermitPdfData {
  orgName: string; orgCode: string; projectName: string; projectCode: string;
  seq: number; kind: PermitKind; title: string; location: string | null; valid_from: string; valid_to: string; status: PermitStatus;
  swms: string | null; plant: string | null; workers: string[]; controls: Control[]; conditions: string | null;
  issuer_name: string; holder_name: string; issuerSig: string | null; holderSig: string | null; issuedAwst: string | null;
  closeout: Control[] | null; closeout_note: string | null; closeoutSig: string | null; closedAwst: string | null; cancel_reason: string | null;
  printedAwst: string;
}

const list = (cs: Control[]) => (
  <table>
    <thead><tr><th className="w">Control</th><th>Answer</th></tr></thead>
    <tbody>{cs.map((c) => <tr key={c.key}><td className="w">{c.label}</td><td className={`mono${c.result ? '' : ' vr-missing'}`}>{c.result === 'yes' ? 'YES' : c.result === 'na' ? 'N/A' : 'NOT ANSWERED'}</td></tr>)}</tbody>
  </table>
);

export function PermitDoc({ data }: { data: PermitPdfData }): ReactElement {
  return (
    <div className="docket permit-doc">
      <header className="head">
        <div className="head__left">
          <p className="lbl"><img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}</p>
          <h1>Permit to work — {KIND_LABEL[data.kind]}</h1>
          <p className="mono sub">{data.projectName} · {data.orgCode}_{data.projectCode}</p>
        </div>
        <div className="head__right">
          <p className="lbl">Permit</p>
          <p className="mono big">{permitRef(data.seq)}</p>
          <p className="mono small">{STATUS_LABEL[data.status]}</p>
        </div>
      </header>
      <section className="sect">
        <table><tbody>
          <tr><th>Task</th><td className="w">{data.title}</td></tr>
          <tr><th>Where</th><td>{data.location ?? '—'}</td></tr>
          <tr><th>Window</th><td className="mono">{fmtPerthDate(data.valid_from)} {awstClock(data.valid_from)} to {fmtPerthDate(data.valid_to)} {awstClock(data.valid_to)} AWST</td></tr>
          <tr><th>SWMS</th><td>{data.swms ?? '—'}</td></tr>
          <tr><th>Plant</th><td>{data.plant ?? '—'}</td></tr>
          <tr><th>Workers</th><td>{data.workers.length ? data.workers.join(', ') : '—'}</td></tr>
          <tr><th>Conditions</th><td className="w">{data.conditions ?? '—'}</td></tr>
        </tbody></table>
      </section>
      <section className="sect"><p className="lbl">Controls before work starts</p>{list(data.controls)}</section>
      <section className="sect sig">
        <p className="lbl">Issued and accepted</p>
        <div className="sig__drawn">
          <figure>{data.issuerSig ? <img src={data.issuerSig} alt="" style={{ height: '16mm' }} /> : <p className="nil">Not signed</p>}<figcaption>Issued by {data.issuer_name}{data.issuedAwst ? ` · ${data.issuedAwst}` : ''}</figcaption></figure>
          <figure>{data.holderSig ? <img src={data.holderSig} alt="" style={{ height: '16mm' }} /> : <p className="nil">Not signed</p>}<figcaption>Accepted by {data.holder_name}</figcaption></figure>
        </div>
      </section>
      {data.closeout && (
        <section className="sect sig">
          <p className="lbl">Close-out</p>
          {list(data.closeout)}
          {data.closeout_note && <p>{data.closeout_note}</p>}
          <div className="sig__drawn"><figure>{data.closeoutSig ? <img src={data.closeoutSig} alt="" style={{ height: '16mm' }} /> : null}<figcaption>Closed{data.closedAwst ? ` · ${data.closedAwst}` : ''}</figcaption></figure></div>
        </section>
      )}
      {data.cancel_reason && <section className="sect"><p className="lbl">Cancelled</p><p>{data.cancel_reason}</p></section>}
      <section className="sect"><p className="src">Printed {data.printedAwst}. An issued permit is frozen; a change is a cancellation and a new permit.</p></section>
    </div>
  );
}

export const PERMIT_CSS = `
.permit-doc .head__right .big { font-size: 13pt; font-weight: 700; margin: 0.5mm 0 0; }
.permit-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.permit-doc tbody th { text-align: left; width: 28mm; font-weight: 600; vertical-align: top; }
.permit-doc td.vr-missing { color: #9A2B2B; font-weight: 700; }
`;
