'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { OWNERSHIP_LABEL, PLANT_KINDS, PLANT_KIND_LABEL, type Ownership, type PlantKind } from '@/lib/plant/checklist';
import { BASIS_LABEL, INSPECTION_BASES, type InspectionBasis } from '@/lib/plant/inspections';
import { plantRegister, type PlantRecord, type PlantRow } from '@/lib/registers/model';
import { Field, Messages, PickBox, PrintBar, Verdict, blankToNull, readMonths, usePick, useSave } from './shared';

export interface Machine extends PlantRow { registration_kind: 'item' | 'design' | null }
export interface Job { id: string; code: string; name: string }
export interface PlantLink { plant_id: string; project_id: string; active: boolean }

interface Draft {
  name: string; plant_no: string; make_model: string; kind: PlantKind; ownership: Ownership; supplier: string; active: boolean;
  basis: InspectionBasis | ''; interval: string;
  regRequired: boolean; regKind: 'item' | 'design'; regNo: string; regExpires: string;
  jobs: Set<string>;
}

const draftOf = (m: Machine | null, jobs: Set<string>): Draft => ({
  name: m?.name ?? '', plant_no: m?.plant_no ?? '', make_model: m?.make_model ?? '',
  kind: (PLANT_KINDS as readonly string[]).includes(m?.kind ?? '') ? (m!.kind as PlantKind) : 'other',
  ownership: m?.ownership && m.ownership in OWNERSHIP_LABEL ? (m.ownership as Ownership) : 'own',
  supplier: m?.supplier ?? '', active: m?.active ?? true,
  basis: m?.inspection_basis ?? '', interval: m?.inspection_interval_months != null ? String(m.inspection_interval_months) : '',
  regRequired: m?.registration_required ?? false, regKind: m?.registration_kind ?? 'item', regNo: m?.registration_no ?? '', regExpires: m?.registration_expires_on ?? '',
  jobs: new Set(jobs),
});

/**
 * The plant register, edited in place (README R118). What is saved here is the
 * machine's own row — the one Plant, the diary's plant list, the prestart form
 * and the printed register all read — so there is nothing to copy across.
 * Inspections and maintenance are records in their own right and are made on
 * the machine's page.
 */
export function PlantEditor({ orgId, projectId, jobs, today, userId, machines, records, links }: {
  orgId: string; projectId: string; jobs: Job[]; today: string; userId: string;
  machines: Machine[]; records: PlantRecord[]; links: PlantLink[];
}) {
  const save = useSave();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null, new Set([projectId])));
  const codeOf = new Map(jobs.map((j) => [j.id, j.code]));
  const jobsOf = (id: string) => new Set(links.filter((l) => l.plant_id === id && l.active).map((l) => l.project_id));
  const jobCodes = new Map(machines.map((m) => [m.id, [...jobsOf(m.id)].map((j) => codeOf.get(j)).filter((c): c is string => Boolean(c))]));
  const sorted = machines.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const pick = usePick(sorted.map((m) => m.id));
  const onThisJob = sorted.filter((m) => jobsOf(m.id).has(projectId)).map((m) => m.id);
  const jobCode = jobs.find((j) => j.id === projectId)?.code;

  const edit = (m: Machine | null) => {
    setDraft(draftOf(m, m ? jobsOf(m.id) : new Set([projectId])));
    setOpen(m ? m.id : 'new');
    save.setError(null);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function commit(m: Machine | null) {
    await save.run(m ? m.id : 'new', async () => {
      if (!draft.name.trim()) throw new Error('Give the machine a name.');
      const supabase = createClient();
      const facts = {
        name: draft.name.trim(), plant_no: blankToNull(draft.plant_no), make_model: blankToNull(draft.make_model),
        kind: draft.kind, ownership: draft.ownership, supplier: blankToNull(draft.supplier), active: draft.active,
        inspection_basis: draft.basis || null, inspection_interval_months: readMonths(draft.interval),
        registration_required: draft.regRequired,
        registration_kind: draft.regRequired ? draft.regKind : null,
        registration_no: draft.regRequired ? blankToNull(draft.regNo) : null,
        registration_expires_on: draft.regRequired ? (draft.regExpires || null) : null,
      };
      let id = m?.id ?? null;
      if (m) {
        const { error } = await supabase.from('plant_register').update(facts).eq('id', m.id);
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? `${facts.name} is already on the register under that number.` : error.message);
      } else {
        const { data, error } = await supabase.from('plant_register').insert({ ...facts, org_id: orgId, created_by: userId }).select('id').single();
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? `${facts.name} is already on the register.` : error.message);
        id = data.id as string;
      }
      const before = m ? jobsOf(m.id) : new Set<string>();
      for (const job of jobs) {
        const on = draft.jobs.has(job.id);
        if (on === before.has(job.id)) continue;
        const { error } = await supabase.from('project_plant').upsert({ project_id: job.id, plant_id: id, active: on }, { onConflict: 'project_id,plant_id' });
        if (error) throw new Error(`Saved, but ${job.code} did not take the change: ${error.message}`);
      }
      setOpen(null);
      return facts.registration_required && !facts.registration_no
        ? 'Saved without a registration number, so this machine cannot be prestarted until one is recorded.'
        : m ? `${facts.name} saved.` : `${facts.name} added to the register.`;
    });
  }

  const form = (m: Machine | null) => (
    <div className="regs__form">
      <div className="regs__fields">
        <Field label="Machine" wide><input className="field field--sm" value={draft.name} placeholder="1.8t Excavator" onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Plant no. / rego"><input className="field field--sm" value={draft.plant_no} placeholder="KBS-01" onChange={(e) => set('plant_no', e.target.value)} /></Field>
        <Field label="Make and model"><input className="field field--sm" value={draft.make_model} placeholder="Kubota U17" onChange={(e) => set('make_model', e.target.value)} /></Field>
        <Field label="Kind">
          <select className="field field--sm" value={draft.kind} onChange={(e) => set('kind', e.target.value as PlantKind)}>
            {PLANT_KINDS.map((k) => <option key={k} value={k}>{PLANT_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Owned or hired">
          <select className="field field--sm" value={draft.ownership} onChange={(e) => set('ownership', e.target.value as Ownership)}>
            {(Object.keys(OWNERSHIP_LABEL) as Ownership[]).map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
          </select>
        </Field>
        <Field label="Supplier / hire company"><input className="field field--sm" value={draft.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
        <Field label="In service">
          <select className="field field--sm" value={draft.active ? 'yes' : 'no'} onChange={(e) => set('active', e.target.value === 'yes')}>
            <option value="yes">In service</option>
            <option value="no">Retired — kept for the record</option>
          </select>
        </Field>
      </div>

      <p className="label regs__sub">Inspections</p>
      <div className="regs__fields">
        <Field label="Inspected on what basis">
          <select className="field field--sm" value={draft.basis} onChange={(e) => set('basis', e.target.value as InspectionBasis | '')}>
            <option value="">No schedule set</option>
            {INSPECTION_BASES.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
          </select>
        </Field>
        <Field label="Every (months)"><input className="field field--sm" inputMode="numeric" value={draft.interval} placeholder="12" onChange={(e) => set('interval', e.target.value)} /></Field>
      </div>

      <p className="label regs__sub">Registration</p>
      <div className="regs__fields">
        <Field label="Must this machine be registered?">
          <select className="field field--sm" value={draft.regRequired ? 'yes' : 'no'} onChange={(e) => set('regRequired', e.target.value === 'yes')}>
            <option value="no">No — most civil plant is not</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        {draft.regRequired && (
          <>
            <Field label="Registered as">
              <select className="field field--sm" value={draft.regKind} onChange={(e) => set('regKind', e.target.value as 'item' | 'design')}>
                <option value="item">An item of plant</option>
                <option value="design">A plant design</option>
              </select>
            </Field>
            <Field label="Registration no."><input className="field field--sm" value={draft.regNo} onChange={(e) => set('regNo', e.target.value)} /></Field>
            <Field label="Expires"><input className="field field--sm" type="date" value={draft.regExpires} onChange={(e) => set('regExpires', e.target.value)} /></Field>
          </>
        )}
      </div>

      <p className="label regs__sub">On which jobs</p>
      <div className="regs__ticks">
        {jobs.map((j) => (
          <label key={j.id} className="regs__tick">
            <input type="checkbox" checked={draft.jobs.has(j.id)} onChange={(e) => setDraft((d) => { const next = new Set(d.jobs); if (e.target.checked) next.add(j.id); else next.delete(j.id); return { ...d, jobs: next }; })} />
            <span>{j.code} · {j.name}</span>
          </label>
        ))}
      </div>

      <div className="regs__actions">
        <button type="button" className="button" disabled={save.busy !== null} onClick={() => void commit(m)}>{save.busy ? 'Saving…' : m ? 'Save' : 'Add to the register'}</button>
        <button type="button" className="linklike" onClick={() => setOpen(null)}>Cancel</button>
        {m && <Link className="linklike" href={`/plant/machine/${m.id}?project=${projectId}`}>Record an inspection or maintenance</Link>}
      </div>
    </div>
  );

  return (
    <div className="regs__list">
      <Messages error={save.error} notice={save.notice} />
      {sorted.length > 0 && <PrintBar pdf="/api/plant/register/pdf" projectId={projectId} pick={pick} all={sorted.map((m) => m.id)} onJob={onThisJob} jobCode={jobCode} />}
      {sorted.length === 0 && <p className="nil">No plant on the register yet.</p>}
      {sorted.map((m) => {
        const row = plantRegister([{ ...m, active: true }], records, jobCodes, today).sections[0].rows[0];
        return (
          <div key={m.id} className={`item regs__row${m.active ? '' : ' regs__row--retired'}`}>
            <div className="regs__head">
              <PickBox id={m.id} pick={pick} label={m.name} />
              <div className="regs__title">
                <p className="regs__name">{m.name}{m.active ? '' : ' · retired'}</p>
                <p className="caption regs__meta">{[m.plant_no ? `No. ${m.plant_no}` : 'No plant number', m.make_model, row[2].text, row[3].text, m.supplier].filter(Boolean).join(' · ')}</p>
              </div>
              {open !== m.id && <button type="button" className="button button--quiet regs__edit" onClick={() => edit(m)}>Edit</button>}
            </div>
            <div className="regs__facts">
              <Verdict label="Registration" cell={row[4]} />
              <Verdict label="Last inspection" cell={row[5]} />
              <Verdict label="Next inspection" cell={row[6]} />
              <Verdict label="On jobs" cell={row[7]} />
            </div>
            {open === m.id && form(m)}
          </div>
        );
      })}
      {open === 'new'
        ? <div className="item regs__row"><p className="regs__name">A new machine</p>{form(null)}</div>
        : <button type="button" className="button button--quiet" onClick={() => edit(null)}>Add a machine</button>}
    </div>
  );
}
