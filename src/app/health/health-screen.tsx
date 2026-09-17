'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { latestPerPerson, leadNotifiedLate } from '@/lib/health/model';

export interface Program { id: string; hazard: string; basis: 'schedule_14' | 'significant_risk' | 'lead_risk_work' | 'asbestos'; frequency_months: number | null; practitioner: string | null; active: boolean }
export interface HealthRecord { id: string; program_id: string; person_name: string; monitored_on: string; practitioner: string; result_summary: string | null; action_required: string | null; next_due_on: string | null; report_file_path: string | null; retain_until: string }
export interface Keeper { user_id: string; active: boolean; granted_at: string; revoked_at: string | null; name: string }
export interface LeadNotice { id: string; description: string; determined_on: string; notified_on: string; reference: string | null; project_id: string | null }

const BASIS_LABEL: Record<Program['basis'], string> = {
  schedule_14: 'Schedule 14 hazardous chemical (reg. 368)',
  significant_risk: 'Significant risk to health shown by the risk assessment (reg. 368)',
  lead_risk_work: 'Lead risk work (Part 7.2)',
  asbestos: 'Asbestos (Part 8)',
};


interface Props {
  orgId: string; projectId: string; isKeeper: boolean; isAdmin: boolean; canManagePrograms: boolean;
  programs: Program[]; records: HealthRecord[]; keepers: Keeper[]; candidates: Array<{ id: string; name: string }>; notices: LeadNotice[];
  ended: Array<{ id: string; program_id: string; person_name: string; ended_on: string; reason: string }>;
  today: string; userId: string;
}

export function HealthScreen({ orgId, projectId, isKeeper, isAdmin, canManagePrograms, programs, records, keepers, candidates, notices, ended, today, userId }: Props) {
  const [ending, setEnding] = useState<{ programId: string; person: string; on: string; reason: string } | null>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [appoint, setAppoint] = useState('');
  const [prog, setProg] = useState({ open: false, hazard: '', basis: 'lead_risk_work' as Program['basis'], months: '', practitioner: '' });
  const [rec, setRec] = useState<{ programId: string | null; person: string; on: string; practitioner: string; result: string; action: string; next: string }>({ programId: null, person: '', on: today, practitioner: '', result: '', action: '', next: '' });
  const [file, setFile] = useState<File | null>(null);
  const [lead, setLead] = useState({ open: false, description: '', determined: today, notified: today, reference: '' });

  useEffect(() => {
    const paths = records.map((r) => r.report_file_path).filter((p): p is string => Boolean(p));
    if (!isKeeper || paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('health-records').createSignedUrls(paths, 600);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const r of data) if (r.path && r.signedUrl) next[r.path] = r.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [records, isKeeper]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }

  const activeKeepers = keepers.filter((k) => k.active);

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}

      <div className={`item${isKeeper ? '' : ' item--warn'}`} style={{ marginTop: '1rem' }}>
        <p className="label">Record keepers</p>
        <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
          {isKeeper ? 'You are a health record keeper for this organisation.' : 'You are not a health record keeper. No monitoring report is shown to you.'}
        </p>
        <p className="caption">{activeKeepers.length === 0 ? 'No keeper appointed yet.' : `Keepers: ${activeKeepers.map((k) => k.name).join(', ')}.`}</p>
        {isAdmin && (
          <>
            {activeKeepers.map((k) => (
              <button key={k.user_id} type="button" className="linklike" disabled={busy !== null} onClick={() => void act(`revoke:${k.user_id}`, async () => {
                const { error: e } = await createClient().from('health_record_keepers').update({ active: false }).eq('org_id', orgId).eq('user_id', k.user_id);
                if (e) throw new Error(e.message);
              })}>Revoke {k.name}{k.user_id === userId ? ' (you)' : ''}</button>
            ))}
            <div className="signin__grid" style={{ alignItems: 'end', marginTop: '0.5rem' }}>
              <label className="fieldcell"><span className="label">Appoint a keeper</span>
                <select className="field field--sm" id="hk-appoint" value={appoint} onChange={(e) => setAppoint(e.target.value)}>
                  <option value="">Choose someone on this job…</option>
                  {candidates.filter((c) => !activeKeepers.some((k) => k.user_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}{c.id === userId ? ' (you)' : ''}</option>)}
                </select></label>
              <button type="button" className="button button--quiet" disabled={busy !== null || !appoint} onClick={() => void act('appoint', async () => {
                const existing = keepers.find((k) => k.user_id === appoint);
                const supabase = createClient();
                const { error: e } = existing
                  ? await supabase.from('health_record_keepers').update({ active: true }).eq('org_id', orgId).eq('user_id', appoint)
                  : await supabase.from('health_record_keepers').insert({ org_id: orgId, user_id: appoint });
                if (e) throw new Error(e.message);
                setAppoint('');
              })}>Appoint</button>
            </div>
            <p className="caption">Appointing and revoking are recorded with who did it. An admin reads no report unless appointed.</p>
          </>
        )}
      </div>

      <p className="label" style={{ marginTop: '1rem' }}>Monitoring programmes</p>
      {programs.length === 0 ? <p className="nil">None set up.</p> : (
        <div className="itp__points">
          {programs.map((p) => {
            const latest = latestPerPerson(records.filter((r) => r.program_id === p.id));
            return (
              <div key={p.id} className="item">
                <p className="label">{p.hazard}{p.active ? '' : ' · retired'}</p>
                <p className="caption">{BASIS_LABEL[p.basis]}{p.frequency_months ? ` · every ${p.frequency_months} months` : ''}{p.practitioner ? ` · ${p.practitioner}` : ''}</p>
                {isKeeper && (
                  <>
                    {latest.length === 0 ? <p className="caption">No monitoring recorded.</p> : (
                      <ul className="gaplist">
                        {latest.map((r) => {
                          const stopped = ended.find((e) => e.program_id === r.program_id && e.person_name.toLowerCase() === r.person_name.toLowerCase() && e.ended_on >= r.monitored_on);
                          return (
                          <li key={r.id} className="caption">
                            <strong>{r.person_name}</strong> · {fmtDate(r.monitored_on)} · {r.practitioner}{r.result_summary ? ` · ${r.result_summary}` : ''}
                            {r.action_required ? ` · action: ${r.action_required}` : ''}
                            {r.next_due_on ? <span className={r.next_due_on < today ? 'vr-missing' : undefined}> · next due {fmtDate(r.next_due_on)}</span> : ''}
                            {r.report_file_path && urls[r.report_file_path] ? <> · <a href={urls[r.report_file_path]} target="_blank" rel="noopener">report</a></> : ''}
                            {' · kept until '}{fmtDate(r.retain_until)}
                            {stopped ? <> · <strong>monitoring ended {fmtDate(stopped.ended_on)}</strong> — {stopped.reason}</> : (
                              <> · <button type="button" className="linklike" onClick={() => setEnding({ programId: r.program_id, person: r.person_name, on: today, reason: '' })}>Monitoring ended</button></>
                            )}
                          </li>
                          );
                        })}
                      </ul>
                    )}
                    {ending && ending.programId === p.id && (
                      <div className="regpanel__form">
                        <p className="label">Monitoring ended — {ending.person}</p>
                        <div className="signin__grid">
                          <label className="fieldcell"><span className="label">Ended on</span>
                            <input className="field field--sm" id="he-on" type="date" max={today} value={ending.on} onChange={(e) => setEnding({ ...ending, on: e.target.value })} /></label>
                          <label className="fieldcell"><span className="label">Why</span>
                            <input className="field field--sm" id="he-reason" placeholder="Left the company; no longer on the work" value={ending.reason} onChange={(e) => setEnding({ ...ending, reason: e.target.value })} /></label>
                        </div>
                        <button type="button" className="button" disabled={busy !== null || !ending.reason.trim()} onClick={() => void act('ended', async () => {
                          const { error: e } = await createClient().from('health_monitoring_ended').insert({ program_id: ending.programId, person_name: ending.person, ended_on: ending.on, reason: ending.reason.trim() });
                          if (e) throw new Error(e.message);
                          setEnding(null);
                        })}>Record it</button>
                        <button type="button" className="linklike" onClick={() => setEnding(null)}>Cancel</button>
                        <p className="caption">Their records stay, kept for the full retention period. They stop showing as due.</p>
                      </div>
                    )}
                    {rec.programId !== p.id ? (
                      <button type="button" className="linklike" onClick={() => setRec({ programId: p.id, person: '', on: today, practitioner: p.practitioner ?? '', result: '', action: '', next: '' })}>Record monitoring</button>
                    ) : (
                      <div className="regpanel__form">
                        <div className="signin__grid">
                          <label className="fieldcell"><span className="label">Worker</span>
                            <input className="field field--sm" id="hr-person" value={rec.person} onChange={(e) => setRec({ ...rec, person: e.target.value })} /></label>
                          <label className="fieldcell"><span className="label">Monitored on</span>
                            <input className="field field--sm" id="hr-on" type="date" value={rec.on} max={today} onChange={(e) => setRec({ ...rec, on: e.target.value })} /></label>
                        </div>
                        <label className="fieldcell"><span className="label">Registered medical practitioner</span>
                          <input className="field field--sm" id="hr-practitioner" value={rec.practitioner} onChange={(e) => setRec({ ...rec, practitioner: e.target.value })} /></label>
                        <label className="fieldcell"><span className="label">Result, as the report states it</span>
                          <input className="field field--sm" id="hr-result" value={rec.result} onChange={(e) => setRec({ ...rec, result: e.target.value })} /></label>
                        <div className="signin__grid">
                          <label className="fieldcell"><span className="label">Action the report recommends</span>
                            <input className="field field--sm" id="hr-action" value={rec.action} onChange={(e) => setRec({ ...rec, action: e.target.value })} /></label>
                          <label className="fieldcell"><span className="label">Next due</span>
                            <input className="field field--sm" id="hr-next" type="date" value={rec.next} onChange={(e) => setRec({ ...rec, next: e.target.value })} /></label>
                        </div>
                        <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
                          {file ? `Chosen: ${file.name}` : 'Attach the report'}
                          <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                        </label>
                        <button type="button" className="button" disabled={busy !== null || !rec.person.trim() || !rec.practitioner.trim()} onClick={() => void act('record', async () => {
                          // Everything the database checks, checked before the confidential file is uploaded (README R78).
                          if (rec.on > today) throw new Error('Monitoring is recorded once it is done.');
                          if (rec.next && rec.next <= rec.on) throw new Error('The next due date must be after the date monitored.');
                          const supabase = createClient();
                          const id = crypto.randomUUID();
                          let path: string | null = null;
                          if (file) {
                            const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
                            path = `${orgId}/${p.id}/${id}.${ext}`;
                            const { error: ue } = await supabase.storage.from('health-records').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
                            if (ue) throw new Error(`The report did not upload: ${ue.message}`);
                          }
                          const { error: e } = await supabase.from('health_monitoring_records').insert({
                            id, program_id: p.id, person_name: rec.person.trim(), monitored_on: rec.on, practitioner: rec.practitioner.trim(),
                            result_summary: rec.result.trim() || null, action_required: rec.action.trim() || null, next_due_on: rec.next || null,
                            report_file_path: path, retain_until: rec.on,
                          });
                          if (e) {
                            if (path) await supabase.storage.from('health-records').remove([path]).catch(() => undefined);
                            throw new Error(e.message);
                          }
                          setRec({ programId: null, person: '', on: today, practitioner: '', result: '', action: '', next: '' });
                          setFile(null);
                        })}>{busy === 'record' ? 'Saving…' : 'Save — confidential'}</button>
                        <button type="button" className="linklike" onClick={() => setRec({ ...rec, programId: null })}>Cancel</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManagePrograms && (!prog.open ? (
        <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setProg({ ...prog, open: true })}>Set up a monitoring programme</button>
      ) : (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          <p className="caption">Set one up only where a trigger applies. Health monitoring is not required for all chemical work.</p>
          <label className="fieldcell"><span className="label">Hazard</span>
            <input className="field field--sm" id="hp-hazard" value={prog.hazard} placeholder="Lead — removing old bridge paint" onChange={(e) => setProg({ ...prog, hazard: e.target.value })} /></label>
          <label className="fieldcell"><span className="label">Why monitoring is required</span>
            <select className="field field--sm" id="hp-basis" value={prog.basis} onChange={(e) => setProg({ ...prog, basis: e.target.value as Program['basis'] })}>
              {(Object.keys(BASIS_LABEL) as Array<Program['basis']>).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select></label>
          <div className="signin__grid">
            <label className="fieldcell fieldcell--narrow"><span className="label">Every (months)</span>
              <input className="field field--sm" id="hp-months" inputMode="numeric" value={prog.months} onChange={(e) => setProg({ ...prog, months: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Registered medical practitioner</span>
              <input className="field field--sm" id="hp-practitioner" value={prog.practitioner} onChange={(e) => setProg({ ...prog, practitioner: e.target.value })} /></label>
          </div>
          <button type="button" className="button" disabled={busy !== null || !prog.hazard.trim()} onClick={() => void act('program', async () => {
            const months = prog.months.trim() ? Number(prog.months) : null;
            const { error: e } = await createClient().from('health_monitoring_programs').insert({ org_id: orgId, hazard: prog.hazard.trim(), basis: prog.basis, frequency_months: months, practitioner: prog.practitioner.trim() || null });
            if (e) throw new Error(e.message);
            setProg({ open: false, hazard: '', basis: 'lead_risk_work', months: '', practitioner: '' });
          })}>Set it up</button>
          <button type="button" className="linklike" onClick={() => setProg({ ...prog, open: false })}>Cancel</button>
        </div>
      ))}

      {(notices.length > 0 || canManagePrograms) && (
        <section style={{ marginTop: '1.25rem' }}>
          <hr className="rule" />
          <p className="label">Lead risk work notified to WorkSafe</p>
          <p className="caption">Within 7 days of determining that work is lead risk work (Part 7.2).</p>
          {notices.length > 0 && (
            <ul className="gaplist">
              {notices.map((n) => <li key={n.id} className="caption">{n.description} · determined {fmtDate(n.determined_on)} · notified {fmtDate(n.notified_on)}{leadNotifiedLate(n.determined_on, n.notified_on) ? <strong className="vr-missing"> · late — after the 7 days</strong> : null}{n.reference ? ` · ${n.reference}` : ''}</li>)}
            </ul>
          )}
          {canManagePrograms && (!lead.open ? (
            <button type="button" className="button button--quiet" onClick={() => setLead({ ...lead, open: true })}>Record a notification</button>
          ) : (
            <div className="item" style={{ marginTop: '0.5rem' }}>
              <label className="fieldcell"><span className="label">The work</span>
                <input className="field field--sm" id="ln-desc" value={lead.description} onChange={(e) => setLead({ ...lead, description: e.target.value })} /></label>
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">Determined lead risk work on</span>
                  <input className="field field--sm" id="ln-determined" type="date" value={lead.determined} max={today} onChange={(e) => setLead({ ...lead, determined: e.target.value })} /></label>
                <label className="fieldcell"><span className="label">WorkSafe notified on</span>
                  <input className="field field--sm" id="ln-notified" type="date" value={lead.notified} max={today} onChange={(e) => setLead({ ...lead, notified: e.target.value })} /></label>
              </div>
              <label className="fieldcell"><span className="label">Reference</span>
                <input className="field field--sm" id="ln-ref" value={lead.reference} onChange={(e) => setLead({ ...lead, reference: e.target.value })} /></label>
              <button type="button" className="button" disabled={busy !== null || !lead.description.trim()} onClick={() => void act('lead', async () => {
                const { error: e } = await createClient().from('lead_risk_notifications').insert({ org_id: orgId, project_id: projectId, description: lead.description.trim(), determined_on: lead.determined, notified_on: lead.notified, reference: lead.reference.trim() || null });
                if (e) throw new Error(e.message.includes('lead_notified_not_before_determined') ? 'WorkSafe cannot have been notified before the work was determined to be lead risk work.' : e.message);
                setLead({ open: false, description: '', determined: today, notified: today, reference: '' });
              })}>Record it</button>
              <button type="button" className="linklike" onClick={() => setLead({ ...lead, open: false })}>Cancel</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
