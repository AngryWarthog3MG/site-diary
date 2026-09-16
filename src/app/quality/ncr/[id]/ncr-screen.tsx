'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { DISPOSITIONS, DISPOSITION_LABEL, NCR_STATUS_LABEL, ncrReportState, type Disposition, type NcrStatus } from '@/lib/quality/model';

interface Ncr {
  id: string; detectedAt: string; detectedBy: string; observation: string; attribution: string; location: string;
  rootCause: string; corrective: string; preventive: string; disposition: Disposition | null; dispositionDetail: string;
  reportedAt: string | null; principalResponse: string; status: NcrStatus; approvedBy: string | null; approvedAt: string | null;
  closedAt: string | null; closeNote: string | null;
}

const when = (iso: string) => {
  const t = new Date(Date.parse(iso) + 8 * 3_600_000).toISOString();
  return `${fmtDate(t.slice(0, 10))} ${t.slice(11, 16)}`;
};

/**
 * An NCR from detection to close-out. What was found is the first account and
 * never changes. The root cause, the corrective and preventative actions and
 * the proposed disposition are worked up while it is open; approving them
 * freezes them and lets testing resume; closing it lifts the hold on the lot.
 */
export function NcrScreen({ ncr, clockHours, canManage }: { ncr: Ncr; clockHours: number | null; canManage: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({
    attribution: ncr.attribution, location: ncr.location, rootCause: ncr.rootCause, corrective: ncr.corrective, preventive: ncr.preventive,
    disposition: (ncr.disposition ?? '') as Disposition | '', dispositionDetail: ncr.dispositionDetail, principalResponse: ncr.principalResponse,
  });
  const [approver, setApprover] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clock = ncrReportState(ncr.detectedAt, ncr.reportedAt, clockHours, new Date().toISOString());
  const open = ncr.status === 'open';
  const readyToApprove = f.rootCause.trim() && f.corrective.trim() && f.disposition;

  async function act(key: string, fields: Record<string, unknown>, done?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await createClient().from('ncrs').update(fields).eq('id', ncr.id);
      if (e) throw new Error(e.message);
      if (done) setNotice(done);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  const workFields = () => ({
    attribution: f.attribution.trim() || null, location: f.location.trim() || null, root_cause: f.rootCause.trim() || null,
    corrective_action: f.corrective.trim() || null, preventive_action: f.preventive.trim() || null,
    disposition: f.disposition || null, disposition_detail: f.dispositionDetail.trim() || null,
    principal_response: f.principalResponse.trim() || null,
  });

  const area = (id: string, label: string, key: keyof typeof f, placeholder = '') => (
    <label className="fieldcell">
      <span className="label">{label}</span>
      <textarea className="field field--sm" id={id} rows={2} value={f[key] as string} placeholder={placeholder} disabled={!open || !canManage} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </label>
  );

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="item">
        <p className="label">What was found — as detected, unchanged</p>
        <p style={{ margin: '0.25rem 0 0' }} className="emerg__pre">{ncr.observation}</p>
        <p className="caption">Detected {when(ncr.detectedAt)} by {ncr.detectedBy}</p>
      </div>

      <div className={`item${clock.state === 'overdue' ? ' item--warn' : ''}`} style={{ marginTop: '0.75rem' }}>
        <p className="label">{NCR_STATUS_LABEL[ncr.status]}</p>
        <p className={`caption${clock.state === 'overdue' ? ' vr-missing' : ''}`}>
          {clock.state === 'no_clock' && 'No contractual deadline to report it to the principal on this job.'}
          {clock.state === 'due' && clock.dueAt && `Report to the principal by ${when(clock.dueAt)}.`}
          {clock.state === 'overdue' && clock.dueAt && `Not reported to the principal by ${when(clock.dueAt)}, as the contract requires.`}
          {clock.state === 'reported' && ncr.reportedAt && `Reported to the principal ${when(ncr.reportedAt)}.`}
        </p>
        {ncr.approvedAt && <p className="caption">Disposition approved {when(ncr.approvedAt)} by {ncr.approvedBy}</p>}
        {ncr.closedAt && <p className="caption">Closed {when(ncr.closedAt)}{ncr.closeNote ? ` · ${ncr.closeNote}` : ''}</p>}
        {canManage && ncr.status !== 'closed' && !ncr.reportedAt && (
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('report', { reported_to_principal_at: new Date().toISOString() }, 'Recorded as reported to the principal now.')}>
            {busy === 'report' ? 'Saving…' : 'Reported to the principal — now'}
          </button>
        )}
      </div>

      <p className="label" style={{ marginTop: '1rem' }}>Working it up</p>
      {area('ncr-attribution', 'Attribution — who or what it is attributed to', 'attribution')}
      {area('ncr-location', 'Location', 'location')}
      {area('ncr-root', 'Root cause', 'rootCause', 'Why it happened, not what happened')}
      {area('ncr-corrective', 'Corrective action', 'corrective', 'What fixes this one')}
      {area('ncr-preventive', 'Preventative action', 'preventive', 'What stops it happening again')}
      <label className="fieldcell">
        <span className="label">Proposed disposition</span>
        <select className="field field--sm" id="ncr-disposition" value={f.disposition} disabled={!open || !canManage} onChange={(e) => setF({ ...f, disposition: e.target.value as Disposition | '' })}>
          <option value="">Not yet decided</option>
          {DISPOSITIONS.map((d) => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
        </select>
      </label>
      {area('ncr-disp-detail', 'How the disposition is carried out', 'dispositionDetail')}
      {area('ncr-response', "The principal's response", 'principalResponse')}

      {canManage && open && (
        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" className="button button--quiet" disabled={busy !== null} onClick={() => void act('save', workFields(), 'Saved.')}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <div className="item">
            <p className="label">Approve the disposition</p>
            <p className="caption">Freezes the root cause, the actions and the disposition, and lets testing on the lot resume.</p>
            <label className="fieldcell">
              <span className="label">Approved by</span>
              <input className="field field--sm" id="ncr-approver" value={approver} placeholder="Name and role — the Superintendent, or yours" onChange={(e) => setApprover(e.target.value)} />
            </label>
            <button type="button" className="button" disabled={busy !== null || !readyToApprove || !approver.trim()} onClick={() => void act('approve', { ...workFields(), approved_by_name: approver.trim(), status: 'approved' })}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            {!readyToApprove && <p className="caption">Needs the root cause, the corrective action and the disposition first.</p>}
          </div>
        </div>
      )}

      {canManage && ncr.status === 'approved' && (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          <p className="label">Close it out</p>
          <p className="caption">When the corrective action is done and verified. Closing lifts the hold on its lot.</p>
          <label className="fieldcell">
            <span className="label">Close-out</span>
            <input className="field field--sm" id="ncr-close" value={closeNote} placeholder="Re-test LAB-2301 conforms" onChange={(e) => setCloseNote(e.target.value)} />
          </label>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void act('close', { status: 'closed', close_note: closeNote.trim() || null })}>
            {busy === 'close' ? 'Closing…' : 'Close the NCR'}
          </button>
        </div>
      )}
    </>
  );
}
