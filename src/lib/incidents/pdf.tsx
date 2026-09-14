import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { KIND_LABEL, STATUS_LABEL, TREATMENT_LABEL, SEVERITY_LABEL, incidentRef, type IncidentKind, type IncidentStatus, type Treatment, type Severity } from './model';

export interface IncidentPdfData {
  orgName: string; orgCode: string; projectName: string; projectCode: string;
  seq: number; kind: IncidentKind; status: IncidentStatus; notifiable: boolean;
  occurred_at: string; reported_on_device_at: string; reported_by: string;
  location: string | null; description: string; immediate_actions: string | null;
  people_involved: string[]; witnesses: string[]; injured_name: string | null; injury_type: string | null; body_part: string | null;
  treatment: Treatment | null; actual_severity: Severity | null; potential_severity: Severity | null; plant: string | null;
  photos: Array<{ src: string }>;
  updates: Array<{ kind: string; body: string; at: string; by: string }>;
  actions: Array<{ action: string; owner: string | null; due: string | null; done_at: string | null; done_note: string | null }>;
  closed_at: string | null; printedAwst: string;
}

export function IncidentDoc({ data }: { data: IncidentPdfData }): ReactElement {
  return (
    <div className="docket incident-doc">
      <header className="head">
        <div className="head__left">
          <p className="lbl"><img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}</p>
          <h1>{KIND_LABEL[data.kind]} report</h1>
          <p className="mono sub">{data.projectName} · {data.orgCode}_{data.projectCode}</p>
        </div>
        <div className="head__right">
          <p className="lbl">Reference</p>
          <p className="mono big">{incidentRef(data.seq)}</p>
          <p className="mono small">{STATUS_LABEL[data.status]}{data.notifiable ? ' · NOTIFIABLE' : ''}</p>
        </div>
      </header>

      <section className="sect">
        <p className="lbl">The report — first account</p>
        <table>
          <tbody>
            <tr><th>When</th><td>{fmtDate(data.occurred_at.slice(0, 10))} {awstClock(data.occurred_at)} AWST</td></tr>
            <tr><th>Where</th><td>{data.location ?? '—'}</td></tr>
            <tr><th>Reported by</th><td>{data.reported_by} · {fmtDate(data.reported_on_device_at.slice(0, 10))} {awstClock(data.reported_on_device_at)} AWST</td></tr>
            <tr><th>What happened</th><td className="w">{data.description}</td></tr>
            <tr><th>Done straight away</th><td className="w">{data.immediate_actions ?? '—'}</td></tr>
            {data.injured_name && <tr><th>Person hurt</th><td>{data.injured_name}{data.injury_type ? ` · ${data.injury_type}` : ''}{data.body_part ? ` · ${data.body_part}` : ''}{data.treatment ? ` · ${TREATMENT_LABEL[data.treatment]}` : ''}</td></tr>}
            <tr><th>People involved</th><td>{data.people_involved.length ? data.people_involved.join(', ') : '—'}</td></tr>
            <tr><th>Witnesses</th><td>{data.witnesses.length ? data.witnesses.join(', ') : '—'}</td></tr>
            <tr><th>Severity</th><td>{data.actual_severity ? SEVERITY_LABEL[data.actual_severity] : '—'} actual · {data.potential_severity ? SEVERITY_LABEL[data.potential_severity] : '—'} potential</td></tr>
            <tr><th>Plant</th><td>{data.plant ?? '—'}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="sect">
        <p className="lbl">Corrective actions</p>
        {data.actions.length === 0 ? <p className="nil">No corrective actions recorded</p> : (
          <table>
            <thead><tr><th className="w">Action</th><th>Owner</th><th>Due</th><th>Done</th></tr></thead>
            <tbody>
              {data.actions.map((a, i) => (
                <tr key={i}>
                  <td className="w">{a.action}{a.done_note ? <span className="src"> — {a.done_note}</span> : null}</td>
                  <td>{a.owner ?? '—'}</td>
                  <td className="mono">{a.due ? fmtDate(a.due) : '—'}</td>
                  <td className={`mono${a.done_at ? '' : ' vr-missing'}`}>{a.done_at ? fmtDate(a.done_at.slice(0, 10)) : 'OPEN'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Updates</p>
        {data.updates.length === 0 ? <p className="nil">No updates</p> : data.updates.map((u, i) => (
          <p key={i} className="incident-doc__update"><span className="mono">{fmtDate(u.at.slice(0, 10))} {awstClock(u.at)}</span> · {u.kind} · {u.by}<br />{u.body}</p>
        ))}
        {data.closed_at && <p className="src">Closed {fmtDate(data.closed_at.slice(0, 10))} {awstClock(data.closed_at)} AWST.</p>}
        <p className="src">Printed {data.printedAwst}. The report is the first account and is never edited; everything after it is an update.</p>
      </section>

      {data.photos.length > 0 && (
        <section className="sect photos">
          <p className="lbl">Photographs</p>
          <div className="photos__grid">
            {data.photos.map((p, i) => (
              <figure key={i}><img src={p.src} alt="" data-shrink="1200" /><figcaption className="mono">{i + 1}. {incidentRef(data.seq)}</figcaption></figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export const INCIDENT_CSS = `
.incident-doc .head__right .big { font-size: 13pt; font-weight: 700; margin: 0.5mm 0 0; }
.incident-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.incident-doc tbody th { text-align: left; width: 32mm; font-weight: 600; vertical-align: top; }
.incident-doc td.vr-missing { color: #9A2B2B; font-weight: 700; }
.incident-doc__update { margin: 1.5mm 0; font-size: 8.5pt; }
`;
