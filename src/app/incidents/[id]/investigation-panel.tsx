'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { SignaturePad } from '@/components/signature-pad';
import {
  causeOptions, finishProblems, investigationDue, investigationExpected, orderWhys, nextWhySeq,
  CAUSE_KIND_LABEL, INVESTIGATION_STATUS_LABEL, type CauseKind, type InvestigationStatus,
} from '@/lib/incidents/investigation';

export interface InvestigationView {
  id: string; status: InvestigationStatus; confidential: boolean; due_on: string | null;
  investigator_id: string | null; investigator_name: string | null;
  summary: string | null; sequence_of_events: string | null; findings: string | null;
  opened_at: string; opened_by_name: string; finished_at: string | null; finished_by_name: string | null;
  signed_off_at: string | null; signed_name: string | null; signature_path: string | null;
  causes: Array<{ id: string; kind: CauseKind; cause_key: string; cause_label: string; detail: string | null }>;
  whys: Array<{ id: string; seq: number; why: string }>;
}

export interface OrgCause { kind: CauseKind; key: string; label: string; active: boolean }
export interface JobPerson { id: string; name: string }

interface Props {
  incidentId: string; projectId: string;
  report: { kind: string; notifiable: boolean; actual_severity: string | null; potential_severity: string | null; status: string };
  investigation: InvestigationView | null;
  /** The report is under investigation but this account does not read the investigation — it is confidential. */
  hiddenConfidential: boolean;
  orgCauses: OrgCause[]; people: JobPerson[];
  canManage: boolean; userId: string; userName: string; today: string;
}

/**
 * The investigation behind a report (README R178): opened by a manager, worked on until it says what happened,
 * why, and what was found, then signed off with a drawn signature and frozen. Every write goes straight to the
 * table under the caller's RLS — the database's trigger is the rule, this screen only shows the amber first.
 */
export function InvestigationPanel({ incidentId, projectId, report, investigation: v, hiddenConfidential, orgCauses, people, canManage, userId, userName, today }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dueOn, setDueOn] = useState(v?.due_on ?? '');
  const [investigator, setInvestigator] = useState(v?.investigator_id ?? '');
  const [investigatorName, setInvestigatorName] = useState(v?.investigator_name ?? '');
  const [confidential, setConfidential] = useState(v?.confidential ?? false);
  const [summary, setSummary] = useState(v?.summary ?? '');
  const [sequence, setSequence] = useState(v?.sequence_of_events ?? '');
  const [findings, setFindings] = useState(v?.findings ?? '');
  const [newCause, setNewCause] = useState<Record<CauseKind, string>>({ root_cause: '', contributing_factor: '' });
  const [causeDetail, setCauseDetail] = useState<Record<CauseKind, string>>({ root_cause: '', contributing_factor: '' });
  const [why, setWhy] = useState('');
  const [signName, setSignName] = useState(userName);
  const [signing, setSigning] = useState(false);
  const closed = report.status === 'closed';
  const expected = investigationExpected(report);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${label}.`); } finally { setBusy(null); }
  }
  const must = (data: unknown[] | null, msg: string) => { if (!data || data.length === 0) throw new Error(msg); };

  const open = () => run('open the investigation', async () => {
    const { error: e } = await createClient().from('incident_investigations').insert({
      incident_id: incidentId, project_id: projectId, opened_by: userId, due_on: dueOn || null,
      investigator_id: investigator || null, investigator_name: investigatorName.trim() || people.find((p) => p.id === investigator)?.name || null, confidential,
    });
    if (e) throw new Error(e.message);
    setEditing(false);
  });
  const save = () => run('save', async () => {
    if (!v) return;
    const { data, error: e } = await createClient().from('incident_investigations').update({
      due_on: dueOn || null, investigator_id: investigator || null,
      investigator_name: investigatorName.trim() || people.find((p) => p.id === investigator)?.name || null,
      confidential, summary: summary || null, sequence_of_events: sequence || null, findings: findings || null,
    }).eq('id', v.id).select('id');
    if (e) throw new Error(e.message); must(data, 'Not allowed from this account.');
    setEditing(false);
  });
  const setStatus = (status: InvestigationStatus) => run('change the status', async () => {
    if (!v) return;
    // Save the words first so the finish sees them.
    const patch: Record<string, unknown> = { status };
    if (editing) Object.assign(patch, { summary: summary || null, sequence_of_events: sequence || null, findings: findings || null, due_on: dueOn || null, confidential });
    const { data, error: e } = await createClient().from('incident_investigations').update(patch).eq('id', v.id).select('id');
    if (e) throw new Error(e.message); must(data, 'Not allowed from this account.');
    setEditing(false);
  });
  const addCause = (kind: CauseKind) => run('add it', async () => {
    if (!v) return;
    const key = newCause[kind]; if (!key) throw new Error('Pick one from the list.');
    const opt = causeOptions(kind, orgCauses).find((o) => o.key === key); if (!opt) throw new Error('Pick one from the list.');
    const { error: e } = await createClient().from('incident_causes').insert({ investigation_id: v.id, kind, cause_key: key, cause_label: opt.label.replace(/ \(retired\)$/, ''), detail: causeDetail[kind].trim() || null, created_by: userId });
    if (e) throw new Error(e.message);
    setNewCause({ ...newCause, [kind]: '' }); setCauseDetail({ ...causeDetail, [kind]: '' });
  });
  const removeCause = (id: string) => run('remove it', async () => {
    const { data, error: e } = await createClient().from('incident_causes').delete().eq('id', id).select('id');
    if (e) throw new Error(e.message); must(data, 'Not allowed from this account.');
  });
  const addWhy = () => run('add the why', async () => {
    if (!v) return;
    if (!why.trim()) throw new Error('Write the answer first.');
    const { error: e } = await createClient().from('incident_whys').insert({ investigation_id: v.id, seq: nextWhySeq(v.whys), why: why.trim(), created_by: userId });
    if (e) throw new Error(e.message);
    setWhy('');
  });
  const removeWhy = (id: string) => run('remove it', async () => {
    const { data, error: e } = await createClient().from('incident_whys').delete().eq('id', id).select('id');
    if (e) throw new Error(e.message); must(data, 'Not allowed from this account.');
  });
  const signOff = (blob: Blob) => run('sign it off', async () => {
    if (!v) return;
    if (!signName.trim()) throw new Error('Type your name beside the signature.');
    setSigning(true);
    const supabase = createClient();
    const path = `${projectId}/incident/${incidentId}/investigation-signoff-${Date.now()}.png`;
    const { error: up } = await supabase.storage.from('entry-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
    if (up) throw new Error(up.message);
    const { data, error: e } = await supabase.from('incident_investigations').update({ status: 'signed_off', signed_name: signName.trim(), signature_path: path }).eq('id', v.id).select('id');
    if (e) throw new Error(e.message); must(data, 'Not allowed from this account.');
    setSigning(false);
  });

  if (hiddenConfidential) {
    return (
      <div className="item">
        <p className="label">Investigation</p>
        <p className="caption">This report is under investigation. The investigation is confidential — its findings are read by the job&rsquo;s managers.</p>
      </div>
    );
  }

  if (!v) {
    if (!canManage || closed) {
      return expected && !closed ? (
        <div className="item"><p className="label">Investigation</p><p className="caption">Not opened yet. A report like this one is usually investigated.</p></div>
      ) : null;
    }
    return (
      <div className="item">
        <p className="label">Investigation</p>
        {!editing ? (
          <>
            {expected && <p className="caption vr-missing">Not opened yet — a report like this one is usually investigated.</p>}
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => setEditing(true)}>Open an investigation</button>
          </>
        ) : (
          <div className="incident__add">
            <InvestigatorFields people={people} investigator={investigator} setInvestigator={setInvestigator} investigatorName={investigatorName} setInvestigatorName={setInvestigatorName} dueOn={dueOn} setDueOn={setDueOn} confidential={confidential} setConfidential={setConfidential} />
            <div className="photo-add-pair">
              <button type="button" className="button" disabled={busy != null} onClick={() => void open()}>{busy ? 'Opening…' : 'Open it'}</button>
              <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => setEditing(false)}>Cancel</button>
            </div>
            {error && <p className="alert" role="alert">{error}</p>}
          </div>
        )}
      </div>
    );
  }

  const due = investigationDue(v, today);
  const frozen = v.status === 'signed_off';
  const editable = canManage && !frozen;
  const problems = finishProblems({ summary: editing ? summary : v.summary, findings: editing ? findings : v.findings }, v.causes);
  const causesOf = (kind: CauseKind) => v.causes.filter((c) => c.kind === kind);

  return (
    <div className="item">
      <p className="label">Investigation{v.confidential ? ' · CONFIDENTIAL' : ''}</p>
      <p className="incident__meta">
        {INVESTIGATION_STATUS_LABEL[v.status]} · opened {fmtPerthDate(v.opened_at)} by {v.opened_by_name}
        {v.investigator_name ? ` · investigator ${v.investigator_name}` : ' · no investigator yet'}
        {v.due_on ? <> · due {fmtDate(v.due_on)}{due === 'overdue' ? <strong className="vr-missing"> · OVERDUE</strong> : due === 'due_soon' ? ' · due soon' : ''}</> : v.status === 'open' ? ' · no due date' : ''}
        {v.finished_at ? ` · finished ${fmtPerthDate(v.finished_at)}${v.finished_by_name ? ` by ${v.finished_by_name}` : ''}` : ''}
        {v.signed_off_at ? ` · signed off ${fmtPerthDate(v.signed_off_at)} by ${v.signed_name}` : ''}
      </p>

      {!editing ? (
        <>
          <Para label="What happened" text={v.summary} />
          <Para label="Sequence of events" text={v.sequence_of_events} />
          <Para label="Findings" text={v.findings} />
          {editable && <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => setEditing(true)}>Edit</button>}
        </>
      ) : (
        <div className="incident__add">
          <InvestigatorFields people={people} investigator={investigator} setInvestigator={setInvestigator} investigatorName={investigatorName} setInvestigatorName={setInvestigatorName} dueOn={dueOn} setDueOn={setDueOn} confidential={confidential} setConfidential={setConfidential} />
          <label className="fieldcell"><span className="label">What happened — summary</span>
            <textarea className="field field--sm" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">Sequence of events</span>
            <textarea className="field field--sm" rows={4} value={sequence} placeholder="In order, with times where known" onChange={(e) => setSequence(e.target.value)} /></label>
          <label className="fieldcell"><span className="label">Findings</span>
            <textarea className="field field--sm" rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} /></label>
          <div className="photo-add-pair">
            <button type="button" className="button" disabled={busy != null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button type="button" className="button button--quiet" disabled={busy != null} onClick={() => { setEditing(false); setSummary(v.summary ?? ''); setSequence(v.sequence_of_events ?? ''); setFindings(v.findings ?? ''); }}>Cancel</button>
          </div>
        </div>
      )}

      {(['root_cause', 'contributing_factor'] as CauseKind[]).map((kind) => (
        <div key={kind} className="incident__update">
          <p className="label">{CAUSE_KIND_LABEL[kind]}</p>
          {causesOf(kind).length === 0 && <p className="nil">{kind === 'root_cause' ? 'None yet — at least one is needed to finish.' : 'None recorded.'}</p>}
          {causesOf(kind).map((c) => (
            <div key={c.id} className="incident__action">
              <div><p className="incident__text">{c.cause_label}</p>{c.detail && <p className="caption">{c.detail}</p>}</div>
              {editable && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void removeCause(c.id)}>Remove</button>}
            </div>
          ))}
          {editable && (
            <div className="signin__grid">
              <label className="fieldcell"><span className="label">Add</span>
                <select className="field field--sm" value={newCause[kind]} onChange={(e) => setNewCause({ ...newCause, [kind]: e.target.value })}>
                  <option value="">Pick one…</option>
                  {causeOptions(kind, orgCauses).filter((o) => !o.retired && !causesOf(kind).some((c) => c.cause_key === o.key)).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select></label>
              <label className="fieldcell"><span className="label">Detail (optional)</span>
                <input className="field field--sm" value={causeDetail[kind]} onChange={(e) => setCauseDetail({ ...causeDetail, [kind]: e.target.value })} /></label>
              <button type="button" className="button button--quiet" disabled={busy != null || !newCause[kind]} onClick={() => void addCause(kind)}>Add</button>
            </div>
          )}
        </div>
      ))}
      {editable && <p className="caption">The lists are the company&rsquo;s: <Link href={`/incidents/causes?project=${projectId}`}>add your own causes and factors</Link>.</p>}

      <div className="incident__update">
        <p className="label">Five whys</p>
        {v.whys.length === 0 && <p className="nil">Not started. Ask why, then why again, until the answer is something the company controls.</p>}
        <ol className="plainlist">
          {orderWhys(v.whys).map((w) => (
            <li key={w.id} className="incident__action">
              <div><p className="incident__text"><strong>Why {w.seq}.</strong> {w.why}</p></div>
              {editable && <button type="button" className="linklike signin__undo" disabled={busy != null} onClick={() => void removeWhy(w.id)}>Remove</button>}
            </li>
          ))}
        </ol>
        {editable && v.whys.length < 9 && (
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Why {nextWhySeq(v.whys)}</span>
              <input className="field field--sm" value={why} placeholder="Because…" onChange={(e) => setWhy(e.target.value)} /></label>
            <button type="button" className="button button--quiet" disabled={busy != null || !why.trim()} onClick={() => void addWhy()}>Add</button>
          </div>
        )}
      </div>

      {error && <p className="alert" role="alert">{error}</p>}

      {editable && v.status === 'open' && (
        <div className="incident__add">
          {problems.length > 0 && <p className="caption vr-missing">Before it can finish it needs {problems.join(', ')}.</p>}
          <button type="button" className="button" disabled={busy != null || problems.length > 0} onClick={() => void setStatus('finished')}>Finish the investigation</button>
        </div>
      )}
      {editable && v.status === 'finished' && (
        <div className="incident__add">
          <p className="caption">Finished. Signing off freezes the investigation — the words, the causes and the whys — for good. Anything found later is an update on the report.</p>
          <label className="fieldcell"><span className="label">Signed by</span>
            <input className="field field--sm" value={signName} onChange={(e) => setSignName(e.target.value)} /></label>
          <p className="label" style={{ marginTop: '0.5rem' }}>Signature — signing saves and freezes it</p>
          <SignaturePad disabled={busy != null} saving={signing} onSave={signOff} />
          <button type="button" className="linklike" disabled={busy != null} onClick={() => void setStatus('open')}>Reopen instead</button>
        </div>
      )}
    </div>
  );
}

function Para({ label, text }: { label: string; text: string | null }) {
  return <p><span className="label">{label}</span> {text ? <span className="incident__text">{text}</span> : <span className="nil">not written yet</span>}</p>;
}

function InvestigatorFields({ people, investigator, setInvestigator, investigatorName, setInvestigatorName, dueOn, setDueOn, confidential, setConfidential }: {
  people: JobPerson[]; investigator: string; setInvestigator: (v: string) => void; investigatorName: string; setInvestigatorName: (v: string) => void;
  dueOn: string; setDueOn: (v: string) => void; confidential: boolean; setConfidential: (v: boolean) => void;
}) {
  return (
    <>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Investigator</span>
          <select className="field field--sm" value={investigator} onChange={(e) => { setInvestigator(e.target.value); const p = people.find((x) => x.id === e.target.value); if (p) setInvestigatorName(p.name); }}>
            <option value="">Someone without a login…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="fieldcell"><span className="label">Name, if no login</span>
          <input className="field field--sm" value={investigatorName} disabled={Boolean(investigator)} onChange={(e) => setInvestigatorName(e.target.value)} /></label>
        <label className="fieldcell fieldcell--narrow"><span className="label">Due</span>
          <input className="field field--sm" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} /> Confidential — read by the job&rsquo;s managers only, not the crew</span></label>
    </>
  );
}
