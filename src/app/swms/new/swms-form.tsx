'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  HRCW_CATEGORIES, PPE_OPTIONS, RISK_LEVELS, RISK_LABEL, BLANK_STEP, KIND_LABEL,
  swmsProblems, swmsWarnings, type SwmsKind, type SwmsStep, type RiskLevel,
} from '@/lib/swms/model';

export interface SwmsFormValues {
  kind: SwmsKind;
  title: string;
  activity: string;
  hrcw: string[];
  ppe: string[];
  permits: string;
  plant: string;
  legislation: string;
  prepared_by: string;
  reviewed_by: string;
  steps: SwmsStep[];
}

interface Props {
  projectId: string;
  userId: string;
  initial: SwmsFormValues;
  crew: string[];
  /** Editing an existing draft. */
  swmsId?: string;
  /** A revision: the active version this one replaces when put into use. */
  supersedesId?: string | null;
}

/**
 * The method statement, written on a phone or a laptop. Saves a draft; the
 * draft is put into use from its own page once it passes the same
 * completeness check the database runs.
 */
export function SwmsForm(props: Props) {
  const router = useRouter();
  const [v, setV] = useState<SwmsFormValues>(props.initial.steps.length ? props.initial : { ...props.initial, steps: [{ ...BLANK_STEP }] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = swmsProblems({ kind: v.kind, hrcw: v.hrcw, prepared_by: v.prepared_by, steps: v.steps });
  const warnings = swmsWarnings({ kind: v.kind, hrcw: v.hrcw, prepared_by: v.prepared_by, steps: v.steps });

  const set = <K extends keyof SwmsFormValues>(key: K, value: SwmsFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: 'hrcw' | 'ppe', item: string) =>
    set(key, v[key].includes(item) ? v[key].filter((x) => x !== item) : [...v[key], item]);
  const patchStep = (i: number, patch: Partial<SwmsStep>) =>
    set('steps', v.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const row = {
        project_id: props.projectId,
        kind: v.kind,
        title: v.title.trim(),
        activity: v.activity.trim() || null,
        hrcw: v.kind === 'swms' ? v.hrcw : [],
        ppe: v.ppe,
        permits: v.permits.trim() || null,
        plant: v.plant.trim() || null,
        legislation: v.legislation.trim() || null,
        prepared_by: v.prepared_by.trim() || null,
        reviewed_by: v.reviewed_by.trim() || null,
        steps: v.steps.filter((s) => s.step.trim() || s.hazards.trim() || s.controls.trim()),
      };
      if (!row.title) throw new Error('Give it a title — the task it covers.');
      if (props.swmsId) {
        const { data, error: upErr } = await supabase.from('swms').update(row).eq('id', props.swmsId).select('id');
        if (upErr) throw new Error(upErr.message);
        if (!data || data.length === 0) throw new Error('This draft could not be saved — it may be in use already.');
        router.push(`/swms/${props.swmsId}`);
      } else {
        const { data, error: insErr } = await supabase
          .from('swms')
          .insert({ ...row, created_by: props.userId, supersedes_id: props.supersedesId ?? null })
          .select('id')
          .single();
        if (insErr) throw new Error(insErr.message);
        router.push(`/swms/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The draft did not save.');
      setSaving(false);
    }
  }

  const riskSelect = (value: RiskLevel | null, onChange: (r: RiskLevel | null) => void) => (
    <select className="field field--sm" value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as RiskLevel | null)}>
      <option value="">—</option>
      {RISK_LEVELS.map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
    </select>
  );

  return (
    <div className="swms-form">
      {!props.swmsId && (
        <div className="fitrow">
          <span className="label">Kind</span>
          <div className="photo-add-pair">
            {(['swms', 'jsa'] as SwmsKind[]).map((k) => (
              <button key={k} type="button" className={`button button--quiet fitbtn${v.kind === k ? ' fitbtn--on' : ''}`} style={{ marginTop: 0 }} onClick={() => set('kind', k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="fieldcell">
        <span className="label">Task</span>
        <input className="field field--sm" value={v.title} placeholder="Excavation for water main, Curtin stage 2" onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="fieldcell">
        <span className="label">What the work involves</span>
        <textarea className="field field--sm" rows={3} value={v.activity} onChange={(e) => set('activity', e.target.value)} />
      </label>

      {v.kind === 'swms' && (
        <div className="item">
          <p className="label">High-risk construction work this covers</p>
          <p className="caption">Tick every one that applies. A SWMS is required for each of these.</p>
          {HRCW_CATEGORIES.map((c) => (
            <label key={c.key} className={`checkrow checkrow--inline${v.hrcw.includes(c.key) ? ' checkrow--on' : ''}`}>
              <input type="checkbox" checked={v.hrcw.includes(c.key)} onChange={() => toggle('hrcw', c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}

      <div className="item">
        <p className="label">Steps, hazards and controls</p>
        {v.steps.map((s, i) => (
          <div key={i} className="swms-step">
            <div className="itemhead">
              <span className="label">Step {i + 1}</span>
              {v.steps.length > 1 && (
                <button type="button" className="quotebtn quotebtn--remove" onClick={() => set('steps', v.steps.filter((_, j) => j !== i))}>Remove</button>
              )}
            </div>
            <label className="fieldcell"><span className="label">What is done</span>
              <textarea className="field field--sm" rows={2} value={s.step} onChange={(e) => patchStep(i, { step: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">What could hurt someone</span>
              <textarea className="field field--sm" rows={2} value={s.hazards} onChange={(e) => patchStep(i, { hazards: e.target.value })} /></label>
            <div className="swms-step__risks">
              <label className="fieldcell fieldcell--narrow"><span className="label">Risk before</span>{riskSelect(s.risk_before, (r) => patchStep(i, { risk_before: r }))}</label>
              <label className="fieldcell fieldcell--narrow"><span className="label">Risk after</span>{riskSelect(s.risk_after, (r) => patchStep(i, { risk_after: r }))}</label>
            </div>
            <label className="fieldcell"><span className="label">Controls — how it is made safe</span>
              <textarea className="field field--sm" rows={3} value={s.controls} onChange={(e) => patchStep(i, { controls: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Who makes sure</span>
              <input className="field field--sm" value={s.who ?? ''} list="swms-crew" placeholder="Supervisor, operator, spotter…" onChange={(e) => patchStep(i, { who: e.target.value || null })} /></label>
          </div>
        ))}
        <datalist id="swms-crew">{props.crew.map((c) => <option key={c} value={c} />)}</datalist>
        <button type="button" className="button button--quiet" onClick={() => set('steps', [...v.steps, { ...BLANK_STEP }])}>Add a step</button>
      </div>

      <div className="item">
        <p className="label">PPE</p>
        <div className="crewchips">
          {PPE_OPTIONS.map((p) => (
            <button key={p} type="button" className={`quotebtn crewchip${v.ppe.includes(p) ? ' crewchip--on' : ''}`} onClick={() => toggle('ppe', p)}>{p}</button>
          ))}
        </div>
        <label className="fieldcell"><span className="label">Permits needed</span>
          <input className="field field--sm" value={v.permits} placeholder="Excavation permit, DBYD, hot work…" onChange={(e) => set('permits', e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Plant and equipment</span>
          <input className="field field--sm" value={v.plant} onChange={(e) => set('plant', e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Legislation, codes and standards</span>
          <input className="field field--sm" value={v.legislation} placeholder="WHS Act 2020 (WA), WHS Regulations 2022, Code of Practice: Excavation work" onChange={(e) => set('legislation', e.target.value)} /></label>
      </div>

      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Prepared by</span>
          <input className="field field--sm" value={v.prepared_by} onChange={(e) => set('prepared_by', e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Reviewed by</span>
          <input className="field field--sm" value={v.reviewed_by} placeholder="Optional" onChange={(e) => set('reviewed_by', e.target.value)} /></label>
      </div>

      {problems.length > 0 && (
        <p className="notice gap">Before it can be put into use: {problems.join('; ')}.</p>
      )}
      {warnings.length > 0 && (
        <p className="notice">Worth a second look: {warnings.join('; ')}.</p>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
      <button type="button" className="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : props.swmsId ? 'Save the draft' : 'Save as a draft'}
      </button>
      <p className="caption">Saving keeps it as a draft. Put it into use from its page, when it is complete.</p>
    </div>
  );
}
