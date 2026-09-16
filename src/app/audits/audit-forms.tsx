'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Schedule { id: string; project_id: string | null; title: string }

/** ISO cl. 9.3.2 — what a management review considers. The first line is the one Spec 201 insists on. */
export const REVIEW_INPUTS_TEMPLATE = [
  'Status of actions from previous reviews:',
  'Changes in external and internal issues, and in legal obligations:',
  'Performance — non-conformities and corrective actions:',
  'Monitoring and measurement results:',
  'Audit results:',
  'Client and interested-party feedback, complaints:',
  'Incidents, near misses and consultation:',
  'Adequacy of resources:',
  'Effectiveness of actions taken on risks and opportunities:',
  'Opportunities for improvement:',
].join('\n\n');

export const REVIEW_OUTPUTS_TEMPLATE = [
  'Decisions on opportunities for improvement:',
  'Changes needed to the management system:',
  'Resources needed:',
].join('\n\n');

function scheduleLabel(s: Schedule) {
  return `${s.title}${s.project_id ? '' : ' (whole company)'}`;
}

/** Start an audit report as a draft, optionally against the schedule it will discharge. */
export function NewAuditForm({ orgId, projectId, today, isAdmin, schedules }: { orgId: string; projectId: string; today: string; isAdmin: boolean; schedules: Schedule[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [scope, setScope] = useState('');
  const [criteria, setCriteria] = useState('ISO 9001:2015; ISO 45001:2018; ISO 14001:2015');
  const [auditor, setAuditor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = schedules.find((s) => s.id === scheduleId) ?? null;
  // A company-wide schedule makes a company-wide report; otherwise the report belongs to this job.
  const reportProject = chosen ? chosen.project_id : projectId;

  if (!open) return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Record an internal audit</button>;
  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      {error && <p className="alert" role="alert">{error}</p>}
      <label className="fieldcell"><span className="label">The schedule it discharges</span>
        <select className="field field--sm" id="au-schedule" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          <option value="">None — not on a schedule</option>
          {schedules.filter((s) => s.project_id !== null || isAdmin).map((s) => <option key={s.id} value={s.id}>{scheduleLabel(s)}</option>)}
        </select></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Audit held</span>
          <input className="field field--sm" id="au-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Auditor</span>
          <input className="field field--sm" id="au-auditor" value={auditor} placeholder="Name, company" onChange={(e) => setAuditor(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">Scope — what was audited</span>
        <input className="field field--sm" id="au-scope" value={scope} placeholder="Earthworks, drainage and plant on Curtin C001" onChange={(e) => setScope(e.target.value)} /></label>
      <label className="fieldcell"><span className="label">Criteria — audited against</span>
        <input className="field field--sm" id="au-criteria" value={criteria} onChange={(e) => setCriteria(e.target.value)} /></label>
      <button type="button" className="button" disabled={busy || !scope.trim() || !criteria.trim() || !auditor.trim()} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const { data, error: e } = await createClient().from('audits').insert({
            org_id: orgId, project_id: reportProject, obligation_id: scheduleId || null, audit_date: date,
            scope: scope.trim(), criteria: criteria.trim(), auditor_name: auditor.trim(),
          }).select('id').single();
          if (e) throw new Error(e.message);
          router.push(`/audits/audit/${data.id}?project=${projectId}`);
        } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(false); }
      }}>{busy ? 'Starting…' : 'Start the report'}</button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

/** Start a management review as a draft, with the inputs ISO cl. 9.3.2 lists already laid out. */
export function NewReviewForm({ orgId, projectId, today, isAdmin, schedules }: { orgId: string; projectId: string; today: string; isAdmin: boolean; schedules: Schedule[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [attendees, setAttendees] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = schedules.find((s) => s.id === scheduleId) ?? null;
  const reviewProject = chosen ? chosen.project_id : projectId;

  if (!open) return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Record a management review</button>;
  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      {error && <p className="alert" role="alert">{error}</p>}
      <label className="fieldcell"><span className="label">The schedule it discharges</span>
        <select className="field field--sm" id="rv-schedule" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          <option value="">None — not on a schedule</option>
          {schedules.filter((s) => s.project_id !== null || isAdmin).map((s) => <option key={s.id} value={s.id}>{scheduleLabel(s)}</option>)}
        </select></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Held on</span>
          <input className="field field--sm" id="rv-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Who attended</span>
          <input className="field field--sm" id="rv-attendees" value={attendees} placeholder="Mitchell Van Zyl, Matthew Rodgers" onChange={(e) => setAttendees(e.target.value)} /></label>
      </div>
      <button type="button" className="button" disabled={busy || !attendees.trim()} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const { data, error: e } = await createClient().from('management_reviews').insert({
            org_id: orgId, project_id: reviewProject, obligation_id: scheduleId || null, held_on: date, attendees: attendees.trim(),
            inputs: REVIEW_INPUTS_TEMPLATE, outputs: REVIEW_OUTPUTS_TEMPLATE,
          }).select('id').single();
          if (e) throw new Error(e.message);
          router.push(`/audits/review/${data.id}?project=${projectId}`);
        } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(false); }
      }}>{busy ? 'Starting…' : 'Start the review'}</button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
