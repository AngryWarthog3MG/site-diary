import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { awstClock } from '@/lib/signin/register';
import { KIND_LABEL, STATUS_LABEL, TREATMENT_LABEL, SEVERITY_LABEL, incidentRef, type IncidentKind, type IncidentStatus, type Treatment, type Severity } from './model';
import { INVESTIGATION_STATUS_LABEL, type InvestigationStatus } from './investigation';
import { controlState, sortControls, CONTROL_LEVEL_SHORT, CONTROL_STATUS_LABEL, CONTROL_STATE_LABEL, type ControlLevel, type ControlStatus } from './controls';

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
  /** The hazard's type and the controls on it (README R179). */
  hazard_type: string | null; critical_risk: boolean;
  controls: Array<{ level: ControlLevel; description: string; status: ControlStatus; created_at: string; in_place_at: string | null; withdrawn_at: string | null; withdrawn_reason: string | null; by: string }>;
  /** The investigation (README R178), when the report has one the caller may read; a confidential one prints only for its managers. */
  investigation: {
    status: InvestigationStatus; confidential: boolean; due_on: string | null; investigator: string | null;
    opened_at: string; opened_by: string; finished_at: string | null; finished_by: string | null;
    summary: string | null; sequence_of_events: string | null; findings: string | null;
    root_causes: Array<{ label: string; detail: string | null }>; factors: Array<{ label: string; detail: string | null }>;
    whys: Array<{ seq: number; why: string }>;
    signed_off_at: string | null; signed_name: string | null; signature: string | null;
  } | null;
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
            <tr><th>When</th><td>{fmtPerthDate(data.occurred_at)} {awstClock(data.occurred_at)} AWST</td></tr>
            <tr><th>Where</th><td>{data.location ?? '—'}</td></tr>
            <tr><th>Reported by</th><td>{data.reported_by} · {fmtPerthDate(data.reported_on_device_at)} {awstClock(data.reported_on_device_at)} AWST</td></tr>
            <tr><th>What happened</th><td className="w">{data.description}</td></tr>
            <tr><th>Done straight away</th><td className="w">{data.immediate_actions ?? '—'}</td></tr>
            {data.injured_name && <tr><th>Person hurt</th><td>{data.injured_name}{data.injury_type ? ` · ${data.injury_type}` : ''}{data.body_part ? ` · ${data.body_part}` : ''}{data.treatment ? ` · ${TREATMENT_LABEL[data.treatment]}` : ''}</td></tr>}
            <tr><th>People involved</th><td>{data.people_involved.length ? data.people_involved.join(', ') : '—'}</td></tr>
            <tr><th>Witnesses</th><td>{data.witnesses.length ? data.witnesses.join(', ') : '—'}</td></tr>
            <tr><th>Severity</th><td>{data.actual_severity ? SEVERITY_LABEL[data.actual_severity] : '—'} actual · {data.potential_severity ? SEVERITY_LABEL[data.potential_severity] : '—'} potential</td></tr>
            <tr><th>Plant</th><td>{data.plant ?? '—'}</td></tr>
            {data.hazard_type && <tr><th>Hazard type</th><td>{data.hazard_type}</td></tr>}
            {data.critical_risk && <tr><th>Critical risk</th><td>Yes — set by the job's managers</td></tr>}
          </tbody>
        </table>
      </section>

      {(data.kind === 'hazard' || data.controls.length > 0) && (
        <section className="sect">
          <p className="lbl">Controls{data.kind === 'hazard' ? ` — ${CONTROL_STATE_LABEL[controlState(data.controls)]}` : ''}</p>
          {data.controls.length === 0 ? <p className="nil vr-missing">No controls recorded</p> : (
            <table>
              <thead><tr><th>Level</th><th className="w">Control</th><th>Status</th><th>By</th></tr></thead>
              <tbody>
                {sortControls(data.controls).map((c, i) => (
                  <tr key={i}>
                    <td>{CONTROL_LEVEL_SHORT[c.level]}</td>
                    <td className="w">{c.description}{c.withdrawn_reason ? <span className="src"> — withdrawn: {c.withdrawn_reason}</span> : null}</td>
                    <td className={`mono${c.status === 'planned' ? ' vr-missing' : ''}`}>{CONTROL_STATUS_LABEL[c.status]}{c.status === 'in_place' && c.in_place_at ? ` ${fmtPerthDate(c.in_place_at)}` : c.status === 'withdrawn' && c.withdrawn_at ? ` ${fmtPerthDate(c.withdrawn_at)}` : ''}</td>
                    <td>{c.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {data.investigation && (
        <section className="sect">
          <p className="lbl">Investigation{data.investigation.confidential ? ' — CONFIDENTIAL' : ''}</p>
          <table>
            <tbody>
              <tr><th>Status</th><td>{INVESTIGATION_STATUS_LABEL[data.investigation.status]}</td></tr>
              <tr><th>Opened</th><td>{fmtPerthDate(data.investigation.opened_at)} by {data.investigation.opened_by}{data.investigation.due_on ? ` · due ${fmtDate(data.investigation.due_on)}` : ''}</td></tr>
              <tr><th>Investigator</th><td>{data.investigation.investigator ?? '—'}</td></tr>
              <tr><th>What happened</th><td className="w">{data.investigation.summary ?? '—'}</td></tr>
              <tr><th>Sequence of events</th><td className="w">{data.investigation.sequence_of_events ?? '—'}</td></tr>
              <tr><th>Findings</th><td className="w">{data.investigation.findings ?? '—'}</td></tr>
              <tr><th>Root causes</th><td className="w">{data.investigation.root_causes.length === 0 ? '—' : data.investigation.root_causes.map((c, i) => <span key={i}>{i > 0 ? <br /> : null}{c.label}{c.detail ? ` — ${c.detail}` : ''}</span>)}</td></tr>
              <tr><th>Contributing factors</th><td className="w">{data.investigation.factors.length === 0 ? '—' : data.investigation.factors.map((c, i) => <span key={i}>{i > 0 ? <br /> : null}{c.label}{c.detail ? ` — ${c.detail}` : ''}</span>)}</td></tr>
              <tr><th>Five whys</th><td className="w">{data.investigation.whys.length === 0 ? '—' : data.investigation.whys.map((w) => <span key={w.seq}>{w.seq > 1 ? <br /> : null}{w.seq}. {w.why}</span>)}</td></tr>
              {data.investigation.finished_at && <tr><th>Finished</th><td>{fmtPerthDate(data.investigation.finished_at)} {awstClock(data.investigation.finished_at)} AWST{data.investigation.finished_by ? ` by ${data.investigation.finished_by}` : ''}</td></tr>}
              <tr><th>Signed off</th><td>
                {data.investigation.signed_off_at ? (
                  <>
                    {data.investigation.signed_name} · {fmtPerthDate(data.investigation.signed_off_at)} {awstClock(data.investigation.signed_off_at)} AWST
                    {data.investigation.signature && <><br /><img className="incident-doc__sig" src={data.investigation.signature} alt="" /></>}
                  </>
                ) : <span className="vr-missing">NOT SIGNED OFF</span>}
              </td></tr>
            </tbody>
          </table>
        </section>
      )}

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
                  <td className={`mono${a.done_at ? '' : ' vr-missing'}`}>{a.done_at ? fmtPerthDate(a.done_at) : 'OPEN'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sect">
        <p className="lbl">Updates</p>
        {data.updates.length === 0 ? <p className="nil">No updates</p> : data.updates.map((u, i) => (
          <p key={i} className="incident-doc__update"><span className="mono">{fmtPerthDate(u.at)} {awstClock(u.at)}</span> · {u.kind} · {u.by}<br />{u.body}</p>
        ))}
        {data.closed_at && <p className="src">Closed {fmtPerthDate(data.closed_at)} {awstClock(data.closed_at)} AWST.</p>}
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
.incident-doc__sig { height: 48px; margin-top: 4px; }
.incident-doc .head__right .big { font-size: 13pt; font-weight: 700; margin: 0.5mm 0 0; }
.incident-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.incident-doc tbody th { text-align: left; width: 32mm; font-weight: 600; vertical-align: top; }
.incident-doc td.vr-missing { color: #9A2B2B; font-weight: 700; }
.incident-doc__update { margin: 1.5mm 0; font-size: 8.5pt; }
`;
