'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { HAZARD_CLASSES, HAZARD_LABEL, type SdsFacts } from '@/lib/chemicals/model';
import { addSafetyDataSheet } from '@/lib/chemicals/add-sheet';
import { chemicalsRegister, type ChemLine } from '@/lib/registers/model';
import { Field, Messages, Verdict, blankToNull, useSave } from './shared';

export interface Product {
  id: string; name: string; manufacturer: string | null; product_code: string | null; hazard_classes: string[];
  dg_class: string | null; used_for: string | null; notes: string | null; active: boolean; sheets: SdsFacts[];
}
export interface OnSite { product_id: string; location: string | null; quantity: string | null; active: boolean }

interface Draft {
  name: string; manufacturer: string; product_code: string; hazards: string[]; dg_class: string; used_for: string; notes: string; active: boolean;
  onJob: boolean; location: string; quantity: string;
}
interface SheetDraft { issued: string; version: string; file: File | null }

const draftOf = (p: Product | null, here: OnSite | undefined): Draft => ({
  name: p?.name ?? '', manufacturer: p?.manufacturer ?? '', product_code: p?.product_code ?? '', hazards: p?.hazard_classes ?? [],
  dg_class: p?.dg_class ?? '', used_for: p?.used_for ?? '', notes: p?.notes ?? '', active: p?.active ?? true,
  onJob: p ? Boolean(here?.active) : true, location: here?.location ?? '', quantity: here?.quantity ?? '',
});

/**
 * The hazardous chemicals register, edited in place (README R118). The product
 * is the company's; where it is kept is this job's. A safety data sheet is a
 * record: a new one is recorded and becomes the sheet the register holds, the
 * old one is retired — a sheet is never rewritten.
 */
export function ChemicalsEditor({ orgId, projectId, jobLabel, today, userId, products, onSite }: {
  orgId: string; projectId: string; jobLabel: string; today: string; userId: string; products: Product[]; onSite: OnSite[];
}) {
  const save = useSave();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null, undefined));
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetDraft>({ issued: '', version: '', file: null });
  const here = new Map(onSite.map((l) => [l.product_id, l]));
  const sorted = products.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const edit = (p: Product | null) => { setDraft(draftOf(p, p ? here.get(p.id) : undefined)); setOpen(p ? p.id : 'new'); setSheetFor(null); save.setError(null); };

  async function commit(p: Product | null) {
    await save.run(p ? p.id : 'new', async () => {
      if (!draft.name.trim()) throw new Error('Give the product its name, as it is on the label.');
      const supabase = createClient();
      const facts = {
        name: draft.name.trim(), manufacturer: blankToNull(draft.manufacturer), product_code: blankToNull(draft.product_code),
        hazard_classes: draft.hazards, dg_class: blankToNull(draft.dg_class), used_for: blankToNull(draft.used_for), notes: blankToNull(draft.notes), active: draft.active,
      };
      let id = p?.id ?? null;
      if (p) {
        const { error } = await supabase.from('chemical_products').update(facts).eq('id', p.id);
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? `${facts.name} is already in the company's list.` : error.message);
      } else {
        const { data, error } = await supabase.from('chemical_products').insert({ ...facts, org_id: orgId, created_by: userId }).select('id').single();
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? `${facts.name} is already in the company's list.` : error.message);
        id = data.id as string;
      }
      const was = p ? here.get(p.id) : undefined;
      const changed = draft.onJob !== Boolean(was?.active) || (draft.onJob && (blankToNull(draft.location) !== (was?.location ?? null) || blankToNull(draft.quantity) !== (was?.quantity ?? null)));
      if (changed && (was || draft.onJob)) {
        const { error } = await supabase.from('project_chemicals').upsert({
          project_id: projectId, product_id: id, location: blankToNull(draft.location), quantity: blankToNull(draft.quantity), active: draft.onJob, created_by: userId,
        });
        if (error) throw new Error(`The product saved, but not its place on this job: ${error.message}`);
      }
      setOpen(null);
      return p ? `${facts.name} saved.` : `${facts.name} recorded. Record its safety data sheet next.`;
    });
  }

  async function commitSheet(p: Product) {
    const ok = await save.run(`sheet:${p.id}`, async () => {
      if (!sheet.issued) throw new Error('Put in the date printed on the sheet.');
      if (sheet.issued > today) throw new Error('A sheet cannot be dated in the future.');
      await addSafetyDataSheet(createClient(), { orgId, productId: p.id, issuedOn: sheet.issued, version: blankToNull(sheet.version), file: sheet.file, userId, existing: p.sheets });
      return 'Sheet recorded. It is now the one the register holds.';
    });
    if (ok) { setSheetFor(null); setSheet({ issued: '', version: '', file: null }); }
  }

  const form = (p: Product | null) => (
    <div className="regs__form">
      <div className="regs__fields">
        <Field label="Product, as on the label" wide><input className="field field--sm" value={draft.name} placeholder="Diesel" onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Manufacturer / supplier"><input className="field field--sm" value={draft.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></Field>
        <Field label="Product code"><input className="field field--sm" value={draft.product_code} onChange={(e) => set('product_code', e.target.value)} /></Field>
        <Field label="Dangerous goods class"><input className="field field--sm" value={draft.dg_class} placeholder="3" onChange={(e) => set('dg_class', e.target.value)} /></Field>
        <Field label="Used for" wide><input className="field field--sm" value={draft.used_for} placeholder="Fuel for plant" onChange={(e) => set('used_for', e.target.value)} /></Field>
        <Field label="Notes" wide><input className="field field--sm" value={draft.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <Field label="In the company's list">
          <select className="field field--sm" value={draft.active ? 'yes' : 'no'} onChange={(e) => set('active', e.target.value === 'yes')}>
            <option value="yes">In use</option>
            <option value="no">Retired — kept for the record</option>
          </select>
        </Field>
      </div>

      <p className="label regs__sub">Hazards named on the label — tick only what the label states</p>
      <div className="regs__ticks regs__ticks--dense">
        {HAZARD_CLASSES.map((h) => (
          <label key={h} className="regs__tick">
            <input type="checkbox" checked={draft.hazards.includes(h)} onChange={(e) => set('hazards', e.target.checked ? [...draft.hazards, h] : draft.hazards.filter((x) => x !== h))} />
            <span>{HAZARD_LABEL[h]}</span>
          </label>
        ))}
      </div>

      <p className="label regs__sub">On this job · {jobLabel}</p>
      <div className="regs__fields">
        <Field label="Kept on this job?">
          <select className="field field--sm" value={draft.onJob ? 'yes' : 'no'} onChange={(e) => set('onJob', e.target.value === 'yes')}>
            <option value="yes">Yes — on this workplace</option>
            <option value="no">No</option>
          </select>
        </Field>
        {draft.onJob && (
          <>
            <Field label="Where it is kept"><input className="field field--sm" value={draft.location} placeholder="Bunded fuel pod" onChange={(e) => set('location', e.target.value)} /></Field>
            <Field label="Quantity"><input className="field field--sm" value={draft.quantity} placeholder="1000 L" onChange={(e) => set('quantity', e.target.value)} /></Field>
          </>
        )}
      </div>

      <div className="regs__actions">
        <button type="button" className="button" disabled={save.busy !== null} onClick={() => void commit(p)}>{save.busy ? 'Saving…' : p ? 'Save' : 'Add to the register'}</button>
        <button type="button" className="linklike" onClick={() => setOpen(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="regs__list">
      <Messages error={save.error} notice={save.notice} />
      {sorted.length === 0 && <p className="nil">No products recorded yet. Add the diesel, the degreaser, the weedkiller, the two-stroke — anything with a hazard on the label.</p>}
      {sorted.map((p) => {
        const link = here.get(p.id);
        const line: ChemLine = { name: p.name, manufacturer: p.manufacturer, product_code: p.product_code, hazardClasses: p.hazard_classes, dgClass: p.dg_class, usedFor: p.used_for, location: link?.location ?? null, quantity: link?.quantity ?? null, sheets: p.sheets };
        const row = chemicalsRegister([line], [], today).sections[0].rows[0];
        const onJob = Boolean(link?.active);
        return (
          <div key={p.id} className={`item regs__row${p.active ? '' : ' regs__row--retired'}`}>
            <div className="regs__head">
              <div>
                <p className="regs__name">{p.name}{p.active ? '' : ' · retired'}</p>
                <p className="caption regs__meta">{[p.manufacturer, p.product_code, p.used_for].filter(Boolean).join(' · ') || 'No manufacturer or use recorded'}</p>
              </div>
              {open !== p.id && <button type="button" className="button button--quiet regs__edit" onClick={() => edit(p)}>Edit</button>}
            </div>
            <div className="regs__facts">
              <Verdict label="Hazards" cell={row[1]} />
              <Verdict label="On this job" cell={onJob ? { text: link?.location || 'Yes — place not recorded', sub: link?.quantity ? `Quantity ${link.quantity}` : null, tone: link?.location ? 'none' : 'warn' } : { text: 'Not on this job', tone: 'none' }} />
              <Verdict label="Sheet issued" cell={row[4]} />
              <Verdict label="Review due" cell={row[5]} />
              <Verdict label="Status" cell={row[6]} />
            </div>
            {open === p.id && form(p)}
            {open !== p.id && sheetFor !== p.id && (
              <p className="regs__links">
                <button type="button" className="linklike" onClick={() => { setSheetFor(p.id); setSheet({ issued: '', version: '', file: null }); setOpen(null); save.setError(null); }}>Record a safety data sheet</button>
                <Link className="linklike" href={`/chemicals/${p.id}?project=${projectId}`}>Open the sheet and its history</Link>
              </p>
            )}
            {sheetFor === p.id && (
              <div className="regs__form">
                <div className="regs__fields">
                  <Field label="Date printed on the sheet"><input className="field field--sm" type="date" max={today} value={sheet.issued} onChange={(e) => setSheet({ ...sheet, issued: e.target.value })} /></Field>
                  <Field label="Version"><input className="field field--sm" value={sheet.version} onChange={(e) => setSheet({ ...sheet, version: e.target.value })} /></Field>
                  <Field label="The sheet itself (PDF or photo)" wide><input className="field field--sm" type="file" accept="application/pdf,image/*" onChange={(e) => setSheet({ ...sheet, file: e.target.files?.[0] ?? null })} /></Field>
                </div>
                <div className="regs__actions">
                  <button type="button" className="button" disabled={save.busy !== null || !sheet.issued} onClick={() => void commitSheet(p)}>{save.busy ? 'Saving…' : 'Record the sheet'}</button>
                  <button type="button" className="linklike" onClick={() => setSheetFor(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {open === 'new'
        ? <div className="item regs__row"><p className="regs__name">A new product</p>{form(null)}</div>
        : <button type="button" className="button button--quiet" onClick={() => edit(null)}>Add a product</button>}
    </div>
  );
}
