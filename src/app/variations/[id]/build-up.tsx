'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { fmtMoney } from '@/lib/money';
import { registerNumber, STATUS_LABEL, type VariationStatus } from '@/lib/claims/register';
import {
  COST_KINDS, KIND_LABEL, KIND_ONE, KIND_UNIT, UNITS, buildUpOpen, cardFor, lineAmount, lineProblems, matchPlantRate, orderLines,
  proposeFromDiary, summarise, type CostKind, type CostLine, type RateItem,
} from '@/lib/variations/costs';
import type { BuildUpData } from '@/lib/variations/load';

type Draft = {
  kind: CostKind;
  description: string;
  person_name: string;
  plant_id: string;
  rate_item_id: string;
  work_date: string;
  quantity: string;
  unit: string;
  rate: string;
  note: string;
};

const blank = (kind: CostKind): Draft => ({ kind, description: '', person_name: '', plant_id: '', rate_item_id: '', work_date: '', quantity: '', unit: KIND_UNIT[kind], rate: '', note: '' });
const toNum = (s: string): number | null | 'bad' => {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'bad';
};
const per = (unit: string) => (unit === 'lump sum' ? '' : `/${unit === 'hour' ? 'h' : unit}`);
const qty = (q: number | null, unit: string) => (q == null ? '—' : unit === 'hour' ? `${q} h` : unit === 'lump sum' ? 'lump sum' : `${q} ${unit}`);

/**
 * The build-up (README R104). The totals first — what is being claimed and what it is made of — then the diary
 * days it stands on, then every line by kind. A register keeper adds, changes and removes lines while the variation
 * is raised or priced; once it is submitted the page reads what was claimed. Amounts on screen are previews: the
 * database works out every one, and the variation's estimate is their sum.
 */
export function BuildUp({ data, canManage, today }: { data: BuildUpData; canManage: boolean; today: string }) {
  const router = useRouter();
  const { register: reg, project } = data;
  const open = buildUpOpen(reg.status);
  const editable = canManage && open;
  const card = useMemo(() => cardFor(data.rates, project.id), [data.rates, project.id]);
  const lines = useMemo(() => orderLines(data.lines), [data.lines]);
  const sum = useMemo(() => summarise(lines), [lines]);
  const proposals = useMemo(() => proposeFromDiary(data.days, data.lines, card), [data.days, data.lines, card]);
  const plantName = (id: string | null) => {
    const p = data.plant.find((x) => x.id === id);
    return p ? `${p.name}${p.plant_no ? ` (${p.plant_no})` : ''}` : null;
  };
  const crewNames = useMemo(() => [...new Set(data.days.flatMap((d) => d.crew))].sort(), [data.days]);
  const unsignedDays = data.days.filter((d) => !d.signed).length;
  const lastSubmission = data.submissions[data.submissions.length - 1];
  const tracker = `/variations?project=${project.id}#vr-${reg.seq}`;

  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function rowFrom(d: Draft): Omit<CostLine, 'id' | 'register_id' | 'amount' | 'source_entry_id' | 'source_variation_id'> | string {
    const q = toNum(d.quantity); const r = toNum(d.rate);
    if (q === 'bad') return 'The quantity is a number, 0 or more.';
    if (r === 'bad') return 'The rate is a number of dollars, 0 or more.';
    const description = d.description.trim() || (d.kind === 'plant' ? plantName(d.plant_id || null) ?? '' : '');
    if (!description) return `Say what the ${KIND_ONE[d.kind]} is.`;
    if (d.work_date && d.work_date > today) return 'A day of work cannot be in the future.';
    return {
      kind: d.kind, description, person_name: d.kind === 'labour' ? d.person_name.trim() || null : null,
      plant_id: d.kind === 'plant' ? d.plant_id || null : null, rate_item_id: d.rate_item_id || null,
      work_date: d.work_date || null, quantity: q, unit: d.unit.trim() || KIND_UNIT[d.kind], rate: r, note: d.note.trim() || null,
    };
  }

  async function run(key: string, fn: () => Promise<{ error: { message: string } | null }>, done: string) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const { error: err } = await fn();
      if (err) throw new Error(err.message);
      setNotice(done);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
      return false;
    } finally { setBusy(null); }
  }

  async function add() {
    if (!adding) return;
    const row = rowFrom(adding);
    if (typeof row === 'string') { setError(row); return; }
    const ok = await run('add', async () => createClient().from('variation_cost_lines').insert({ ...row, register_id: reg.id, project_id: project.id }), `${KIND_LABEL[row.kind]} line added.`);
    if (ok) setAdding(null);
  }

  async function save() {
    if (!editing) return;
    const row = rowFrom(editing.draft);
    if (typeof row === 'string') { setError(row); return; }
    const ok = await run(editing.id, async () => createClient().from('variation_cost_lines').update(row).eq('id', editing.id), 'Line saved.');
    if (ok) setEditing(null);
  }

  async function remove(id: string) {
    const ok = await run(id, async () => createClient().from('variation_cost_lines').delete().eq('id', id), 'Line removed.');
    if (ok) setRemoving(null);
  }

  async function bringIn() {
    await run('diary', async () => createClient().from('variation_cost_lines').insert(proposals.map((p) => ({ ...p, register_id: reg.id, project_id: project.id }))),
      `${proposals.length} labour line${proposals.length === 1 ? '' : 's'} brought in from the diary.`);
  }

  const startEdit = (l: CostLine) => {
    setEditing({ id: l.id, draft: { kind: l.kind, description: l.description, person_name: l.person_name ?? '', plant_id: l.plant_id ?? '', rate_item_id: l.rate_item_id ?? '', work_date: l.work_date ?? '', quantity: l.quantity == null ? '' : String(l.quantity), unit: l.unit, rate: l.rate == null ? '' : String(l.rate), note: l.note ?? '' } });
    setAdding(null); setError(null); setNotice(null);
  };

  return (
    <div className="bu">
      <nav className="bu-nav" aria-label="Variations">
        <Link href={tracker} className="chip chip--link">‹ Variation tracker</Link>
        {data.siblings.length > 1 && (
          <select className="field field--sm bu-switch" value={reg.id} aria-label="Go to another variation" onChange={(e) => router.push(`/variations/${e.target.value}?project=${project.id}`)}>
            {data.siblings.map((s) => (
              <option key={s.id} value={s.id}>{registerNumber(s.seq)} · {s.title}{s.value != null ? ` · ${fmtMoney(s.value)}` : ''}</option>
            ))}
          </select>
        )}
        <Link href={`/rates?project=${project.id}`} className="chip chip--link">Rates</Link>
      </nav>

      <p className="bu-status caption">
        {STATUS_LABEL[reg.status as VariationStatus] ?? reg.status}{reg.vr_ref ? ` · client ref ${reg.vr_ref}` : ''}
        {data.days.length ? ` · ${data.days.length} day${data.days.length === 1 ? '' : 's'} in the diary` : ''}
      </p>

      {/* What is being claimed, and what it is made of. */}
      <div className="bu-totals">
        <div className="bu-totals__main">
          <span className="label">{reg.agreed_cost != null ? 'Built up' : 'Claim'}</span>
          <strong className="mono">{sum.count ? fmtMoney(sum.total) : '—'}</strong>
          <span className="caption">{sum.count ? `${sum.count} line${sum.count === 1 ? '' : 's'}` : 'No lines yet'}</span>
        </div>
        {COST_KINDS.map((k) => (
          <div key={k} className={sum.countByKind[k] ? '' : 'bu-totals--none'}>
            <span className="label">{KIND_LABEL[k]}</span>
            <strong className="mono">{sum.countByKind[k] ? fmtMoney(sum.byKind[k]) : '—'}</strong>
            <span className="caption">{sum.countByKind[k] ? `${sum.countByKind[k]} line${sum.countByKind[k] === 1 ? '' : 's'}` : 'none'}</span>
          </div>
        ))}
        {reg.agreed_cost != null && (
          <div className="bu-totals__agreed"><span className="label">Agreed</span><strong className="mono">{fmtMoney(reg.agreed_cost)}</strong><span className="caption">what the client agreed</span></div>
        )}
      </div>
      {(sum.unpriced > 0 || sum.noQuantity > 0) && (
        <p className="bu-warn">
          {[sum.unpriced ? `${sum.unpriced} line${sum.unpriced === 1 ? ' has' : 's have'} no rate` : '', sum.noQuantity ? `${sum.noQuantity} line${sum.noQuantity === 1 ? ' has' : 's have'} no hours or quantity` : '']
            .filter(Boolean).join(' and ')} — the claim leaves {sum.unpriced + sum.noQuantity === 1 ? 'it' : 'them'} out until you say.
        </p>
      )}
      {reg.estimate_source === 'manual' && reg.estimated_cost != null && sum.count === 0 && editable && (
        <p className="caption">This variation carries a typed estimate of {fmtMoney(reg.estimated_cost)}. Adding the first line replaces it with the build-up.</p>
      )}
      {!open && (
        <p className="notice">
          {STATUS_LABEL[reg.status as VariationStatus] ?? reg.status}
          {lastSubmission ? ` — sent ${fmtPerthDate(lastSubmission.at)} at ${fmtMoney(lastSubmission.total)} over ${lastSubmission.lines ?? 0} line${lastSubmission.lines === 1 ? '' : 's'}` : ''}.
          {' '}The build-up is what was claimed and cannot change. To change it, move the variation back to Priced on the tracker — the history keeps both.
        </p>
      )}
      {!canManage && <p className="notice">The build-up is kept by supervisors, project managers and admins.</p>}
      {data.staleEntries.length > 0 && (
        <p className="bu-warn">{data.staleEntries.length} diary day{data.staleEntries.length === 1 ? ' behind these lines has' : 's behind these lines have'} since been corrected. Check the hours against the signed correction.</p>
      )}
      {error && <p className="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {/* The days it stands on. */}
      <section className="bu-section">
        <h2 className="bu-h">From the diary</h2>
        {data.days.length === 0 ? <p className="caption">No diary day records this variation.</p> : (
          <ul className="plainlist bu-days">
            {data.days.map((d) => (
              <li key={d.variationId}>
                <Link href={d.signed ? `/entries/${d.entryId}/signed` : `/entries/${d.entryId}/review`} className="mono claims-cite">{fmtDate(d.date)}</Link>
                <span>{d.hours == null ? 'hours not stated' : `${d.hours} h`}{d.crew.length ? ` · ${d.crew.join(', ')}` : ' · crew not named'}</span>
                {d.description && <span className="caption bu-days__what">{d.description}</span>}
                {!d.signed && <span className="bu-flag">not signed</span>}
              </li>
            ))}
          </ul>
        )}
        {editable && proposals.length > 0 && (
          <button type="button" className="button" disabled={busy != null} onClick={() => void bringIn()}>
            {busy === 'diary' ? 'Bringing in…' : `Bring in the labour from the diary · ${proposals.length} line${proposals.length === 1 ? '' : 's'}`}
          </button>
        )}
        {editable && unsignedDays > 0 && <p className="caption">{unsignedDays} day{unsignedDays === 1 ? ' is' : 's are'} not signed yet — their hours come in once signed.</p>}
        {editable && proposals.length > 0 && card.filter((r) => r.kind === 'labour').length === 0 && (
          <p className="caption">No labour rates on the card yet, so the lines come in without a rate. <Link href={`/rates?project=${project.id}`}>Set the rates</Link> first, or price each line.</p>
        )}
      </section>

      {/* The lines, by kind. */}
      {COST_KINDS.filter((k) => lines.some((l) => l.kind === k)).map((k) => (
        <section key={k} className="bu-section">
          <h2 className="bu-h">{KIND_LABEL[k]} <span className="mono">{fmtMoney(sum.byKind[k])}</span></h2>
          <ul className="plainlist bu-lines">
            {lines.filter((l) => l.kind === k).map((l) => {
              const problems = lineProblems(l);
              const cardRate = card.find((r) => r.id === l.rate_item_id);
              if (editing?.id === l.id) {
                return <li key={l.id} className="bu-line bu-line--edit"><LineForm draft={editing.draft} onChange={(d) => setEditing({ id: l.id, draft: d })} card={card} plant={data.plant} crew={crewNames} today={today} busy={busy === l.id} onSave={() => void save()} onCancel={() => setEditing(null)} saveLabel="Save" /></li>;
              }
              return (
                <li key={l.id} className="bu-line">
                  <div className="bu-line__what">
                    <strong>{l.kind === 'labour' ? (l.person_name ?? 'Crew not named') : l.kind === 'plant' ? (plantName(l.plant_id) ?? l.description) : l.description}</strong>
                    <span className="caption">
                      {[l.kind === 'labour' ? l.description : l.kind === 'plant' && plantName(l.plant_id) && l.description.trim().toLowerCase() !== (data.plant.find((x) => x.id === l.plant_id)?.name ?? '').trim().toLowerCase() ? l.description : '', l.work_date ? fmtDate(l.work_date) : '', l.source_entry_id ? 'from the diary' : '']
                        .filter(Boolean).join(' · ')}
                    </span>
                    {l.note && <span className="caption">{l.note}</span>}
                    {problems.length > 0 && <span className="bu-flag">needs {problems.join(' and ')}</span>}
                    {cardRate && l.rate != null && cardRate.rate !== l.rate && <span className="caption">card rate now {fmtMoney(cardRate.rate)}{per(cardRate.unit)}</span>}
                    {l.source_entry_id && data.staleEntries.includes(l.source_entry_id) && <span className="bu-flag">day since corrected</span>}
                  </div>
                  <div className="bu-line__sum mono">
                    <span>{qty(l.quantity, l.unit)} × {l.rate == null ? '—' : `${fmtMoney(l.rate)}${per(l.unit)}`}</span>
                    <strong>{fmtMoney(l.amount)}</strong>
                  </div>
                  {editable && (
                    <div className="bu-line__act">
                      <button type="button" className="quotebtn" disabled={busy != null} onClick={() => startEdit(l)}>Edit</button>
                      {removing === l.id
                        ? <button type="button" className="quotebtn quotebtn--remove" disabled={busy != null} onClick={() => void remove(l.id)}>{busy === l.id ? 'Removing…' : 'Sure? Remove'}</button>
                        : <button type="button" className="quotebtn quotebtn--remove" disabled={busy != null} onClick={() => setRemoving(l.id)}>Remove</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {editable && (
        <section className="bu-section">
          {adding ? (
            <div className="item bu-add">
              <div className="bu-kinds" role="tablist" aria-label="What kind of line">
                {COST_KINDS.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={adding.kind === k} className={`review-tab${adding.kind === k ? ' is-active' : ''}`} onClick={() => setAdding(blank(k))}>{KIND_LABEL[k]}</button>
                ))}
              </div>
              <LineForm draft={adding} onChange={setAdding} card={card} plant={data.plant} crew={crewNames} today={today} busy={busy === 'add'} onSave={() => void add()} onCancel={() => setAdding(null)} saveLabel="Add the line" />
            </div>
          ) : (
            <div className="claims-actions">
              {COST_KINDS.map((k) => (
                <button key={k} type="button" className={k === 'labour' ? 'button' : 'button button--quiet'} onClick={() => { setAdding(blank(k)); setEditing(null); setError(null); setNotice(null); }}>
                  Add {KIND_ONE[k]}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {data.submissions.length > 0 && (
        <section className="bu-section">
          <h2 className="bu-h">What was claimed</h2>
          <ul className="plainlist bu-days">
            {data.submissions.map((s) => (
              <li key={s.at}><span className="mono">{fmtPerthDate(s.at)}</span><span>sent at {fmtMoney(s.total)} over {s.lines ?? 0} line{s.lines === 1 ? '' : 's'}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One line's fields — used to add a line and to change one. Picking a rate fills what it knows; everything stays editable. */
function LineForm({ draft, onChange, card, plant, crew, today, busy, onSave, onCancel, saveLabel }: {
  draft: Draft; onChange: (d: Draft) => void; card: Array<RateItem & { scope: 'job' | 'company' }>;
  plant: BuildUpData['plant']; crew: string[]; today: string; busy: boolean; onSave: () => void; onCancel: () => void; saveLabel: string;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const rates = card.filter((r) => r.kind === draft.kind);
  const q = toNum(draft.quantity); const r = toNum(draft.rate);
  const preview = q === 'bad' || r === 'bad' ? null : lineAmount(q, r);
  const pickRate = (id: string) => {
    const it = rates.find((x) => x.id === id);
    if (!it) { onChange({ ...draft, rate_item_id: '' }); return; }
    onChange({ ...draft, rate_item_id: it.id, description: it.label, unit: it.unit, rate: String(it.rate), plant_id: it.plant_id ?? draft.plant_id });
  };
  const pickPlant = (id: string) => {
    const p = plant.find((x) => x.id === id) ?? null;
    const it = draft.rate_item_id ? null : matchPlantRate(p, rates);
    onChange({ ...draft, plant_id: id, ...(it ? { rate_item_id: it.id, unit: it.unit, rate: String(it.rate) } : {}), description: draft.description || (it?.label ?? p?.name ?? '') });
  };
  const units = UNITS.includes(draft.unit as (typeof UNITS)[number]) ? UNITS : [draft.unit, ...UNITS];
  return (
    <div className="bu-form">
      <label className="fieldcell"><span className="label">From the rates</span>
        <select className="field field--sm" value={draft.rate_item_id} onChange={(e) => pickRate(e.target.value)}>
          <option value="">{rates.length ? 'Pick a rate…' : 'No rates of this kind on the card'}</option>
          {rates.map((it) => <option key={it.id} value={it.id}>{it.label} — {fmtMoney(it.rate)}{per(it.unit)}{it.scope === 'job' ? ' (this job)' : ''}</option>)}
        </select></label>
      {draft.kind === 'plant' && (
        <label className="fieldcell"><span className="label">Machine</span>
          <select className="field field--sm" value={draft.plant_id} onChange={(e) => pickPlant(e.target.value)}>
            <option value="">Pick the machine…</option>
            {plant.map((p) => <option key={p.id} value={p.id}>{p.name}{p.plant_no ? ` (${p.plant_no})` : ''}{p.onJob ? '' : ' — not on this job'}</option>)}
          </select></label>
      )}
      {draft.kind === 'labour' && (
        <label className="fieldcell"><span className="label">Who</span>
          <input className="field field--sm" list="bu-crew" value={draft.person_name} placeholder="Name, or leave blank" onChange={(e) => set('person_name', e.target.value)} />
          <datalist id="bu-crew">{crew.map((n) => <option key={n} value={n} />)}</datalist></label>
      )}
      <label className="fieldcell"><span className="label">{draft.kind === 'labour' ? 'Worked as' : draft.kind === 'plant' ? 'Described as' : 'What it is'}</span>
        <input className="field field--sm" value={draft.description} placeholder={draft.kind === 'labour' ? 'Labourer' : draft.kind === 'plant' ? 'Excavator 5t, wet hire' : draft.kind === 'material' ? 'Road base' : 'Traffic control'} onChange={(e) => set('description', e.target.value)} /></label>
      <div className="bu-form__nums">
        <label className="fieldcell"><span className="label">{draft.unit === 'hour' ? 'Hours' : 'Quantity'}</span>
          <input className="field field--sm" inputMode="decimal" value={draft.quantity} placeholder="8" onChange={(e) => set('quantity', e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Unit</span>
          <select className="field field--sm" value={draft.unit} onChange={(e) => set('unit', e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        <label className="fieldcell"><span className="label">Rate ($ ex GST)</span>
          <input className="field field--sm" inputMode="decimal" value={draft.rate} placeholder="95" onChange={(e) => set('rate', e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Day (optional)</span>
          <input className="field field--sm" type="date" max={today} value={draft.work_date} onChange={(e) => set('work_date', e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">Note (optional)</span>
        <input className="field field--sm" value={draft.note} placeholder="Docket 4411, hired from Coates" onChange={(e) => set('note', e.target.value)} /></label>
      <p className="bu-preview mono">{preview == null ? 'Amount: — (needs the quantity and a rate)' : `Amount: ${fmtMoney(preview)}`}</p>
      <div className="claims-actions">
        <button type="button" className="button" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : saveLabel}</button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
