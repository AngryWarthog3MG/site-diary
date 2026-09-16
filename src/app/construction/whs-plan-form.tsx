'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Whether this company is the principal contractor on the job. Admin only; the database checks. */
export function PrincipalToggle({ projectId, isPrincipal, canChange }: { projectId: string; isPrincipal: boolean; canChange: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function set(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await createClient().from('projects').update({ is_principal_contractor: value }).eq('id', projectId);
      if (e) throw new Error(e.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className={`checkrow${isPrincipal ? ' checkrow--on' : ''}`}>
        <input type="checkbox" id="pc-toggle" checked={isPrincipal} disabled={!canChange || busy} onChange={(e) => void set(e.target.checked)} />
        <span>We are the principal contractor on this job{canChange ? '' : ' — an admin sets this'}</span>
      </label>
      {error && <p className="alert" role="alert">{error}</p>}
    </>
  );
}

interface Plan {
  version: number;
  responsibilities: string;
  consultation_arrangements: string;
  incident_arrangements: string;
  site_rules: string;
  swms_arrangements: string;
  other_matters: string | null;
}

/**
 * Write the WHS management plan, or issue a revision of it. The five headings
 * are reg. 310(1)'s. A revision starts from the version in force and asks why it
 * was revised, because reg. 312 requires the plan kept up to date as the work
 * changes and reg. 313 keeps every version.
 */
export function WhsPlanForm({ projectId, current }: { projectId: string; current: Plan | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(current == null);
  const [responsibilities, setResponsibilities] = useState(current?.responsibilities ?? '');
  const [consultation, setConsultation] = useState(current?.consultation_arrangements ?? '');
  const [incidents, setIncidents] = useState(current?.incident_arrangements ?? '');
  const [rules, setRules] = useState(current?.site_rules ?? '');
  const [swms, setSwms] = useState(current?.swms_arrangements ?? '');
  const [other, setOther] = useState(current?.other_matters ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = [responsibilities, consultation, incidents, rules, swms].every((v) => v.trim());

  async function issue() {
    if (!ready) { setError('Each of the five headings the regulation lists needs an answer.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await createClient().from('whs_management_plans').insert({
        project_id: projectId, version: 0,
        responsibilities: responsibilities.trim(), consultation_arrangements: consultation.trim(),
        incident_arrangements: incidents.trim(), site_rules: rules.trim(), swms_arrangements: swms.trim(),
        other_matters: other.trim() || null, revision_reason: current ? (reason.trim() || null) : null,
      });
      if (e) throw new Error(e.message);
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Revise the plan</button>;
  }

  const area = (id: string, label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <label className="fieldcell">
      <span className="label">{label}</span>
      <textarea className="field field--sm" id={id} rows={3} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      <p className="label">{current ? `Version ${current.version + 1}` : 'The WHS management plan'}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {area('wp-resp', 'Who is responsible for what — names, positions, WHS responsibilities', responsibilities, setResponsibilities, 'Project manager: …\nSite supervisor: Matthew Rodgers — daily prestart, permits, SWMS sign-on\nFirst aiders: …')}
      {area('wp-consult', 'Consultation, cooperation and coordination between businesses on site', consultation, setConsultation, 'Weekly coordination meeting with each subcontractor; shared prestart; HSR …')}
      {area('wp-incident', 'How incidents are managed', incidents, setIncidents, 'Reported in the app the same shift; notifiable incidents phoned to WorkSafe by …')}
      {area('wp-rules', 'Site rules, and how people are told them', rules, setRules, 'PPE, speed limit, exclusion zones, no-go areas. Told at induction and on the site board.')}
      {area('wp-swms', 'How SWMS are collected, checked, monitored and reviewed', swms, setSwms, 'Each subcontractor gives its SWMS before starting; checked by the supervisor; reviewed when the task or a control changes.')}
      {area('wp-other', 'Anything else', other, setOther, 'Optional')}
      {current && (
        <label className="fieldcell">
          <span className="label">Why it is being revised</span>
          <input className="field field--sm" id="wp-reason" value={reason} placeholder="Stage 2 earthworks start; new subcontractor on site" onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <button type="button" className="button" disabled={busy || !ready} onClick={() => void issue()}>
        {busy ? 'Issuing…' : current ? `Issue version ${current.version + 1}` : 'Issue the plan'}
      </button>
      {current && <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>}
      <p className="caption">Once issued a version does not change. Every version is kept.</p>
    </div>
  );
}
