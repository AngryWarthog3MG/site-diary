'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import {
  REGISTER_STATUS_LABEL, planReviewDue, notRequiredProblem, removalProblems, isLicensedRemoval,
  type RegisterStatus,
} from '@/lib/asbestos/model';

export interface RegisterRow {
  id: string; status: RegisterStatus; duty_holder: string; register_date: string; reference: string | null; summary: string | null;
  asbestos_present: boolean; file_path: string | null; plan_file_path: string | null; plan_date: string | null; superseded_by: string | null;
  built_after_2003: boolean | null; none_identified: boolean | null; none_likely: boolean | null;
  asbestos_acknowledgements: Array<{ id: string; person_name: string; briefed_on: string }>;
}
export interface RemovalRow {
  id: string; location: string; friable: boolean; area_m2: number | string | null; removalist: string; licence_class: 'A' | 'B'; licence_no: string;
  emergency: boolean; notified_worksafe_on: string; notification_reference: string | null; work_start_on: string; clearance_certificate: string | null;
}

interface Props {
  projectId: string; registers: RegisterRow[]; inForceId: string | null; notBriefed: string[]; removals: RemovalRow[];
  today: string; canManage: boolean; canBrief: boolean;
}

function useSigned(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('|');
  useEffect(() => {
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('asbestos-docs').createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const r of data) if (r.path && r.signedUrl) next[r.path] = r.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

export function AsbestosScreen({ projectId, registers, inForceId, notBriefed, removals, today, canManage, canBrief }: Props) {
  const router = useRouter();
  const inForce = registers.find((r) => r.id === inForceId) ?? null;
  const earlier = registers.filter((r) => r.id !== inForceId);
  const urls = useSigned(registers.flatMap((r) => [r.file_path, r.plan_file_path]).filter((p): p is string => Boolean(p)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ status: 'received' as RegisterStatus, duty: '', date: today, reference: '', summary: '', present: false, after2003: false, noneId: false, noneLikely: false, planDate: '' });
  const [file, setFile] = useState<File | null>(null);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [rm, setRm] = useState({ open: false, location: '', friable: false, area: '', removalist: '', cls: 'B' as 'A' | 'B', licence: '', emergency: false, notified: today, ref: '', start: '', clearance: '' });

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }

  const upload = async (id: string, which: 'register' | 'plan', f: File) => {
    const ext = (f.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
    const path = `${projectId}/${id}/${which}.${ext}`;
    const { error: e } = await createClient().storage.from('asbestos-docs').upload(path, f, { contentType: f.type || 'application/pdf', upsert: false });
    if (e) throw new Error(`The ${which} file did not upload: ${e.message}`);
    return path;
  };

  const limbsProblem = n.status === 'not_required' ? notRequiredProblem(n.after2003, n.noneId, n.noneLikely) : null;
  const planNeedsDate = Boolean(planFile) && !n.planDate;
  const removalIssues = rm.start ? removalProblems({ friable: rm.friable, area_m2: rm.area ? Number(rm.area) : null, licence_class: rm.cls, emergency: rm.emergency, notified_worksafe_on: rm.notified, work_start_on: rm.start }) : [];

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}

      {!inForce ? (
        <p className="nil" style={{ marginTop: '1rem' }}>
          No asbestos register recorded for this workplace. Ask whoever has management or control of the site for theirs — on a
          principal contractor&rsquo;s job that is them — and record it here, or record that none is required.
        </p>
      ) : (
        <div className={`item${inForce.asbestos_present ? ' item--warn' : ''}`} style={{ marginTop: '1rem' }}>
          <p className="label">{REGISTER_STATUS_LABEL[inForce.status]}</p>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
            {inForce.status === 'not_required' ? 'No asbestos register required' : inForce.asbestos_present ? 'Asbestos identified or presumed on this workplace' : 'No asbestos identified on this workplace'}
          </p>
          {inForce.summary && <p className="emerg__pre">{inForce.summary}</p>}
          <p className="caption">
            Duty holder: {inForce.duty_holder} · dated {fmtDate(inForce.register_date)}{inForce.reference ? ` · ${inForce.reference}` : ''}
            {inForce.file_path && urls[inForce.file_path] ? <> · <a href={urls[inForce.file_path]} target="_blank" rel="noopener">the register</a></> : ''}
          </p>
          {inForce.asbestos_present && (
            <p className={`caption${inForce.plan_file_path ? '' : ' vr-missing'}`}>
              {inForce.plan_file_path
                ? <>Management plan dated {inForce.plan_date ? fmtDate(inForce.plan_date) : '—'}{planReviewDue(inForce) ? ` · review by ${fmtDate(planReviewDue(inForce)!)}` : ''}{urls[inForce.plan_file_path] ? <> · <a href={urls[inForce.plan_file_path]} target="_blank" rel="noopener">the plan</a></> : ''}</>
                : 'No asbestos management plan recorded — one is required where asbestos is identified or presumed (reg. 429).'}
            </p>
          )}
        </div>
      )}

      {inForce && inForce.asbestos_present && (
        <section style={{ marginTop: '1rem' }}>
          <p className="label">Crew briefed on this register</p>
          {inForce.asbestos_acknowledgements.length > 0 && (
            <p className="caption">{inForce.asbestos_acknowledgements.map((a) => `${a.person_name} (${fmtDate(a.briefed_on)})`).join(', ')}</p>
          )}
          {notBriefed.length === 0 ? <p className="caption">Everyone on the crew list has been briefed.</p> : (
            <>
              <p className="caption vr-missing">Not yet briefed:</p>
              <div className="crewchips">
                {notBriefed.map((name) => (
                  <button key={name} type="button" className="quotebtn crewchip" disabled={!canBrief || busy !== null} onClick={() => void act(`brief:${name}`, async () => {
                    const { error: e } = await createClient().from('asbestos_acknowledgements').insert({ register_id: inForce.id, person_name: name, briefed_on: today });
                    if (e) throw new Error(e.message);
                  })}>{canBrief ? `+ ${name} briefed today` : name}</button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {canManage && (!adding ? (
        <button type="button" className="button button--quiet" style={{ marginTop: '1rem' }} onClick={() => setAdding(true)}>
          {inForce ? 'Record a newer register' : 'Record the register'}
        </button>
      ) : (
        <div className="item" style={{ marginTop: '1rem' }}>
          <label className="fieldcell"><span className="label">This is</span>
            <select className="field field--sm" id="as-status" value={n.status} onChange={(e) => setN({ ...n, status: e.target.value as RegisterStatus })}>
              {(['received', 'own', 'not_required'] as const).map((s) => <option key={s} value={s}>{REGISTER_STATUS_LABEL[s]}</option>)}
            </select></label>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Who holds the duty</span>
              <input className="field field--sm" id="as-duty" value={n.duty} placeholder="The person with management or control of the workplace" onChange={(e) => setN({ ...n, duty: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Dated</span>
              <input className="field field--sm" id="as-date" type="date" value={n.date} max={today} onChange={(e) => setN({ ...n, date: e.target.value })} /></label>
          </div>
          {n.status !== 'not_required' ? (
            <>
              <label className="fieldcell"><span className="label">Reference</span>
                <input className="field field--sm" id="as-ref" value={n.reference} onChange={(e) => setN({ ...n, reference: e.target.value })} /></label>
              <label className="fieldcell"><span className="label">What it says, in brief</span>
                <textarea className="field field--sm" id="as-summary" rows={2} value={n.summary} placeholder="Bonded AC sheeting in the plant room eaves; none in the work area" onChange={(e) => setN({ ...n, summary: e.target.value })} /></label>
              <label className={`checkrow${n.present ? ' checkrow--on' : ''}`}>
                <input type="checkbox" id="as-present" checked={n.present} onChange={(e) => setN({ ...n, present: e.target.checked })} />
                <span>Asbestos is identified or presumed on this workplace</span>
              </label>
              <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
                {file ? `Chosen: ${file.name}` : 'Attach the register'}
                <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {n.present && (
                <div className="signin__grid" style={{ alignItems: 'end' }}>
                  <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
                    {planFile ? `Chosen: ${planFile.name}` : 'Attach the management plan'}
                    <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <label className="fieldcell"><span className="label">Plan dated</span>
                    <input className="field field--sm" id="as-plan-date" type="date" value={n.planDate} max={today} onChange={(e) => setN({ ...n, planDate: e.target.value })} /></label>
                </div>
              )}
            </>
          ) : (
            <>
              {([['after2003', 'The building was constructed after 31 December 2003'], ['noneId', 'No asbestos has been identified'], ['noneLikely', 'No asbestos is likely to be present']] as const).map(([k, label]) => (
                <label key={k} className={`checkrow${n[k] ? ' checkrow--on' : ''}`}>
                  <input type="checkbox" id={`as-${k}`} checked={n[k]} onChange={(e) => setN({ ...n, [k]: e.target.checked })} />
                  <span>{label}</span>
                </label>
              ))}
              {limbsProblem && <p className="caption">{limbsProblem}</p>}
            </>
          )}
          <button type="button" className="button" disabled={busy !== null || !n.duty.trim() || Boolean(limbsProblem) || planNeedsDate} onClick={() => void act('register', async () => {
            const id = crypto.randomUUID();
            const supabase = createClient();
            const filePath = n.status !== 'not_required' && file ? await upload(id, 'register', file) : null;
            const planPath = n.status !== 'not_required' && n.present && planFile ? await upload(id, 'plan', planFile) : null;
            const { error: e } = await supabase.from('asbestos_registers').insert({
              id, project_id: projectId, status: n.status, duty_holder: n.duty.trim(), register_date: n.date,
              reference: n.reference.trim() || null, summary: n.summary.trim() || null,
              asbestos_present: n.status === 'not_required' ? false : n.present,
              file_path: filePath, plan_file_path: planPath, plan_date: planPath ? n.planDate : null,
              built_after_2003: n.status === 'not_required' ? n.after2003 : null,
              none_identified: n.status === 'not_required' ? n.noneId : null,
              none_likely: n.status === 'not_required' ? n.noneLikely : null,
            });
            if (e) {
              const orphans = [filePath, planPath].filter((p): p is string => Boolean(p));
              if (orphans.length) await supabase.storage.from('asbestos-docs').remove(orphans).catch(() => undefined);
              throw new Error(e.message);
            }
            if (inForce) {
              const { error: se } = await supabase.from('asbestos_registers').update({ superseded_by: id }).eq('id', inForce.id);
              if (se) throw new Error(`Recorded, but the earlier register was not marked superseded: ${se.message}`);
            }
            setAdding(false); setFile(null); setPlanFile(null);
          })}>{busy === 'register' ? 'Saving…' : 'Save'}</button>
          <button type="button" className="linklike" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ))}

      {(removals.length > 0 || canManage) && (
        <section style={{ marginTop: '1.25rem' }}>
          <hr className="rule" />
          <p className="label">Removal</p>
          {removals.length === 0 ? <p className="caption">No removal recorded.</p> : (
            <ul className="gaplist">
              {removals.map((r) => (
                <li key={r.id}>
                  <strong>{r.location}</strong> · {r.friable ? 'friable' : 'non-friable'}{r.area_m2 != null ? `, ${r.area_m2} m²` : ''} · from {fmtDate(r.work_start_on)}
                  <br /><span className="caption">{r.removalist} · Class {r.licence_class} {r.licence_no} · WorkSafe notified {fmtDate(r.notified_worksafe_on)}{r.emergency ? ' (emergency)' : ''}{r.notification_reference ? ` · ${r.notification_reference}` : ''}{r.clearance_certificate ? ` · clearance ${r.clearance_certificate}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage && (!rm.open ? (
            <button type="button" className="button button--quiet" onClick={() => setRm({ ...rm, open: true })}>Record a removal</button>
          ) : (
            <div className="item" style={{ marginTop: '0.5rem' }}>
              <label className="fieldcell"><span className="label">Where</span>
                <input className="field field--sm" id="rm-loc" value={rm.location} onChange={(e) => setRm({ ...rm, location: e.target.value })} /></label>
              <div className="signin__grid">
                <label className={`checkrow${rm.friable ? ' checkrow--on' : ''}`}>
                  <input type="checkbox" id="rm-friable" checked={rm.friable} onChange={(e) => setRm({ ...rm, friable: e.target.checked, cls: e.target.checked ? 'A' : rm.cls })} />
                  <span>Friable</span>
                </label>
                <label className="fieldcell fieldcell--narrow"><span className="label">Area (m²)</span>
                  <input className="field field--sm" id="rm-area" inputMode="decimal" value={rm.area} onChange={(e) => setRm({ ...rm, area: e.target.value })} /></label>
              </div>
              {!isLicensedRemoval(rm.friable, rm.area ? Number(rm.area) : null) && rm.area !== '' && (
                <p className="caption">Non-friable up to 10 m² does not need a licensed removalist, though it may still be recorded here.</p>
              )}
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">Removalist</span>
                  <input className="field field--sm" id="rm-who" value={rm.removalist} onChange={(e) => setRm({ ...rm, removalist: e.target.value })} /></label>
                <label className="fieldcell fieldcell--narrow"><span className="label">Class</span>
                  <select className="field field--sm" id="rm-class" value={rm.cls} onChange={(e) => setRm({ ...rm, cls: e.target.value as 'A' | 'B' })}>
                    <option value="A">A</option><option value="B">B</option>
                  </select></label>
                <label className="fieldcell"><span className="label">Licence</span>
                  <input className="field field--sm" id="rm-licence" value={rm.licence} onChange={(e) => setRm({ ...rm, licence: e.target.value })} /></label>
              </div>
              <label className={`checkrow${rm.emergency ? ' checkrow--on' : ''}`}>
                <input type="checkbox" id="rm-emergency" checked={rm.emergency} onChange={(e) => setRm({ ...rm, emergency: e.target.checked })} />
                <span>Emergency removal — WorkSafe phoned immediately, written notice within 24 hours</span>
              </label>
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">WorkSafe notified</span>
                  <input className="field field--sm" id="rm-notified" type="date" value={rm.notified} max={today} onChange={(e) => setRm({ ...rm, notified: e.target.value })} /></label>
                <label className="fieldcell"><span className="label">Work starts</span>
                  <input className="field field--sm" id="rm-start" type="date" value={rm.start} onChange={(e) => setRm({ ...rm, start: e.target.value })} /></label>
              </div>
              <div className="signin__grid">
                <label className="fieldcell"><span className="label">Notification reference</span>
                  <input className="field field--sm" id="rm-ref" value={rm.ref} onChange={(e) => setRm({ ...rm, ref: e.target.value })} /></label>
                <label className="fieldcell"><span className="label">Clearance certificate</span>
                  <input className="field field--sm" id="rm-clearance" value={rm.clearance} onChange={(e) => setRm({ ...rm, clearance: e.target.value })} /></label>
              </div>
              {removalIssues.map((p) => <p key={p} className="caption vr-missing">{p}</p>)}
              <button type="button" className="button" disabled={busy !== null || !rm.location.trim() || !rm.removalist.trim() || !rm.licence.trim() || !rm.start || removalIssues.length > 0} onClick={() => void act('removal', async () => {
                const { error: e } = await createClient().from('asbestos_removals').insert({
                  project_id: projectId, location: rm.location.trim(), friable: rm.friable, area_m2: rm.area ? Number(rm.area) : null,
                  removalist: rm.removalist.trim(), licence_class: rm.cls, licence_no: rm.licence.trim(), emergency: rm.emergency,
                  notified_worksafe_on: rm.notified, notification_reference: rm.ref.trim() || null, work_start_on: rm.start, clearance_certificate: rm.clearance.trim() || null,
                });
                if (e) throw new Error(e.message);
                setRm({ open: false, location: '', friable: false, area: '', removalist: '', cls: 'B', licence: '', emergency: false, notified: today, ref: '', start: '', clearance: '' });
              })}>{busy === 'removal' ? 'Saving…' : 'Record the removal'}</button>
              <button type="button" className="linklike" onClick={() => setRm({ ...rm, open: false })}>Cancel</button>
            </div>
          ))}
        </section>
      )}

      {earlier.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary className="caption">Earlier registers ({earlier.length})</summary>
          <ul className="gaplist">
            {earlier.map((r) => (
              <li key={r.id} className="caption">
                {fmtDate(r.register_date)} · {REGISTER_STATUS_LABEL[r.status]} · {r.duty_holder}{r.summary ? ` · ${r.summary}` : ''}
                {r.file_path && urls[r.file_path] ? <> · <a href={urls[r.file_path]} target="_blank" rel="noopener">register</a></> : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
