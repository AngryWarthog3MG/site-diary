'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { usePending } from '@/lib/outbox/use-pending';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { Fold } from '@/components/fold';
import { PRIORITY_LABEL, type ActionPriority } from '@/lib/actions/model';
import {
  ASSET_CLASSES, ASSET_OWNERSHIP, ASSET_RECORD_KINDS, CLASS_LABEL, DUE_LABEL, METER_UNITS, OUTCOME_LABEL, OWNERSHIP_LABEL, PROFILE_KINDS, PROFILE_KIND_LABEL,
  RECORD_KIND_LABEL, custodySays, describeProfile, presetsFor, profileState,
  type AssetClass, type AssetOwnership, type AssetRecordKind, type AssetVerdict, type DoneFacts, type MeterFacts, type MeterUnit, type Outcome, type ProfileKind, type ProfileRow,
} from '@/lib/assets/model';
import type { Unit } from '@/lib/forms/schedule';
import { Field, Messages, blankToNull, useSave } from '../../registers/shared';

export interface AssetRecordRow {
  id: string; profile_id: string | null; kind: AssetRecordKind; done_on: string; performed_by_name: string; competence: string | null; organisation: string | null;
  meter_reading: number | null; outcome: Outcome | null; findings: string | null; next_due_on: string | null; file_path: string | null; created_at: string;
}
export interface CheckoutRow {
  id: string; holder_name: string; purpose: string | null; due_back_on: string | null; out_at: string; condition_out: string | null; in_at: string | null; condition_in: string | null; project_code: string | null;
}
export interface OpenAction { id: string; profile_id: string; due_on: string; action: string; detail: string | null; priority: ActionPriority; assigned_to: string | null; done_at: string | null }

interface Props {
  orgId: string; projectId: string; userId: string; today: string;
  verdict: AssetVerdict; profiles: ProfileRow[]; done: DoneFacts[]; readings: MeterFacts[];
  records: AssetRecordRow[]; history: CheckoutRow[]; actions: OpenAction[];
  people: Array<{ id: string; name: string }>; jobs: Array<{ id: string; code: string; name: string }>;
  canManage: boolean;
}

const fmtHours = (n: number) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 1 })} h`;
const toneClass = (s: 'overdue' | 'due_soon' | 'upcoming' | 'none') => (s === 'overdue' ? ' regs__fact--bad' : s === 'due_soon' ? ' regs__fact--warn' : s === 'upcoming' ? ' regs__fact--ok' : '');

/**
 * One asset's page (README R186). Facts behind Edit; custody and the meter through the outbox so
 * they work with no signal; profiles and records written live, because a profile is set from a
 * desk and a record carries a file. A machine's records stay on its own page.
 */
export function AssetScreen({ orgId, projectId, userId, today, verdict, profiles, done, readings, records, history, actions, people, jobs, canManage }: Props) {
  const a = verdict.asset;
  const isPlant = a.plant_id != null;
  const q = `?project=${projectId}`;
  const who = custodySays(verdict.custody, today);
  const states = profiles.map((p) => profileState(p, done, readings, today)).sort((x, y) => Number(!x.profile.active) - Number(!y.profile.active) || (x.due ?? '9999').localeCompare(y.due ?? '9999'));
  const pendingOut = usePending('asset_checkout', a.id, 'subject');
  const pendingMeter = usePending('asset_meter', a.id, 'subject');
  const pendingIn = usePending('asset_checkin', verdict.custody?.id ?? 'none', 'subject');
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? 'Someone on another job' : null);

  return (
    <div className="regs">
      <section className="card">
        <div className="regs__facts">
          <span className={`regs__fact${verdict.profiles.length ? toneClass(verdict.status) : ''}`}>
            <span className="regs__fact-label">Next due</span>
            <span className="regs__fact-text">{verdict.next ? verdict.next.says : 'Nothing set to fall due'}</span>
            {verdict.next && <span className="regs__fact-sub">{verdict.next.profile.label} · {DUE_LABEL[verdict.status]}</span>}
          </span>
          <span className={`regs__fact${verdict.custody ? (who.tone === 'bad' ? ' regs__fact--bad' : ' regs__fact--ok') : ''}`}>
            <span className="regs__fact-label">Custody</span>
            <span className="regs__fact-text">{who.text}{pendingOut.length > 0 ? ' · on the phone, not yet sent' : ''}</span>
            {verdict.custody && <span className="regs__fact-sub">Out since {fmtPerthDate(verdict.custody.out_at)}</span>}
          </span>
          <span className="regs__fact">
            <span className="regs__fact-label">Meter</span>
            <span className="regs__fact-text">{verdict.meter ? fmtHours(verdict.meter.reading) : '—'}{pendingMeter.length > 0 ? ' · a reading waits on the phone' : ''}</span>
            {verdict.meter && <span className="regs__fact-sub">{fmtDate(verdict.meter.read_on)} · {verdict.meter.source === 'prestart' ? 'prestart' : verdict.meter.source === 'service' ? 'service record' : 'read by hand'}</span>}
          </span>
          <span className="regs__fact">
            <span className="regs__fact-label">Kept at</span>
            <span className="regs__fact-text">{a.location ?? '—'}</span>
          </span>
          <span className="regs__fact">
            <span className="regs__fact-label">Ownership</span>
            <span className="regs__fact-text">{OWNERSHIP_LABEL[a.ownership]}</span>
            {(a.supplier || a.hire_ref) && <span className="regs__fact-sub">{[a.supplier, a.hire_ref].filter(Boolean).join(' · ')}</span>}
          </span>
          {(a.serial_no || a.barcode) && (
            <span className="regs__fact">
              <span className="regs__fact-label">Serial · barcode</span>
              <span className="regs__fact-text">{[a.serial_no, a.barcode].filter(Boolean).join(' · ')}</span>
            </span>
          )}
        </div>
        {a.notes && <p className="caption" style={{ marginTop: '0.6rem' }}>{a.notes}</p>}
        {!a.active && <p className="alert" style={{ marginTop: '0.6rem' }}>Retired{a.retired_reason ? ` — ${a.retired_reason}` : ''}. Kept for the record; nothing is checked out or falls due on it.</p>}
        <p className="regs__links">
          {isPlant && <Link className="linklike" href={`/plant/machine/${a.plant_id}${q}`}>The machine&rsquo;s page — prestarts, inspections, registration</Link>}
          {a.active && <a className="linklike" href={`/api/assets/labels?project=${projectId}&ids=${a.id}`} target="_blank" rel="noreferrer">QR label</a>}
        </p>
        {canManage && <Fold label={isPlant ? 'Edit where it is kept, its serial, barcode and notes' : 'Edit the asset'}><EditAsset asset={a} isPlant={isPlant} today={today} /></Fold>}
      </section>

      {a.active && (
        <section className="card" style={{ marginTop: '0.75rem' }}>
          <p className="label">Custody</p>
          {verdict.custody
            ? <CheckIn checkout={verdict.custody} projectId={projectId} pending={pendingIn.length > 0} canManage={canManage} />
            : canManage && <CheckOut assetId={a.id} orgId={orgId} projectId={projectId} jobs={jobs} today={today} pending={pendingOut.length > 0} />}
          {history.length > 0 && (
            <Fold label="Who has had it" count={history.length}>
              <ul className="regs__others">
                {history.map((h) => (
                  <li key={h.id}>
                    <strong>{h.holder_name}</strong>{h.project_code ? ` on ${h.project_code}` : ''} · out {fmtPerthDate(h.out_at)}{h.in_at ? ` · back ${fmtPerthDate(h.in_at)}` : ' · still out'}
                    {h.purpose ? ` · ${h.purpose}` : ''}{h.condition_out ? ` · out: ${h.condition_out}` : ''}{h.condition_in ? ` · back: ${h.condition_in}` : ''}
                  </li>
                ))}
              </ul>
            </Fold>
          )}
        </section>
      )}

      <section className="card" style={{ marginTop: '0.75rem' }}>
        <p className="label">What falls due on it</p>
        {states.length === 0 && <p className="caption">Nothing is set. Add what this asset needs — a test and tag, a six-monthly service, an annual inspection — and the register, What&rsquo;s due and the action register will carry it.</p>}
        {states.length > 0 && (
          <div className="regs__list">
            {states.map((s) => (
              <div key={s.profile.id} className={`regs__row${s.profile.active ? '' : ' regs__row--retired'}`}>
                <div className="regs__head">
                  <div className="regs__title">
                    <p className="regs__name">{s.profile.label} <span className="review-muted">· {PROFILE_KIND_LABEL[s.profile.kind]} · {describeProfile(s.profile)}</span></p>
                    <p className={`regs__meta regs__fact${s.profile.active ? toneClass(s.status) : ''}`}><span className="regs__fact-text">{s.says}</span></p>
                    <p className="caption">
                      {s.profile.basis ?? ''}{s.profile.assigned_to ? ` · goes to ${nameOf(s.profile.assigned_to)}` : ''}{s.profile.priority !== 'normal' ? ` · ${PRIORITY_LABEL[s.profile.priority]}` : ''}
                      {s.profile.notes ? ` · ${s.profile.notes}` : ''}
                    </p>
                  </div>
                  {canManage && s.profile.active && <RetireProfile profile={s.profile} />}
                </div>
              </div>
            ))}
          </div>
        )}
        {canManage && a.active && <Fold label="Add something that falls due"><AddProfile asset={a} orgId={orgId} today={today} people={people} meter={verdict.meter} /></Fold>}
        {actions.length > 0 && (
          <>
            <p className="regs__sub label">Open actions raised on it</p>
            <ul className="regs__others">
              {actions.map((x) => (
                <li key={x.id}>
                  <strong>{x.action}</strong> · due {fmtDate(x.due_on)}{x.due_on < today ? ' · overdue' : ''}{x.priority !== 'normal' ? ` · ${PRIORITY_LABEL[x.priority]}` : ''}
                  {x.assigned_to ? ` · ${nameOf(x.assigned_to)}` : ''}{x.detail ? ` · ${x.detail}` : ''}
                </li>
              ))}
            </ul>
            <p className="caption">An action closes itself when the inspection, test or service is recorded; or close it on the <Link className="linklike" href={`/actions${q}`}>action register</Link>.</p>
          </>
        )}
      </section>

      {a.active && (
        <section className="card" style={{ marginTop: '0.75rem' }}>
          <p className="label">Meter</p>
          <p className="caption">
            {isPlant ? 'The hour meter from every completed prestart and service record counts; a reading by hand too.' : 'A reading by hand, or from a service record. A service profile by hours counts from it.'}
          </p>
          {canManage && <AddMeter assetId={a.id} projectId={projectId} today={today} latest={verdict.meter} />}
          {readings.length > 0 && (
            <Fold label="Readings" count={readings.length}>
              <ul className="regs__others">
                {[...readings].sort((x, y) => y.read_on.localeCompare(x.read_on) || y.reading - x.reading).slice(0, 40).map((r, i) => (
                  <li key={`${r.read_on}-${r.reading}-${i}`}>{fmtDate(r.read_on)} · {fmtHours(r.reading)} · {r.source === 'prestart' ? 'prestart' : r.source === 'service' ? 'service record' : 'read by hand'}</li>
                ))}
              </ul>
            </Fold>
          )}
        </section>
      )}

      <section className="card" style={{ marginTop: '0.75rem' }}>
        <p className="label">Inspections, tests and services on record</p>
        {isPlant
          ? <p className="caption">A machine&rsquo;s inspections and maintenance are recorded on <Link className="linklike" href={`/plant/machine/${a.plant_id}${q}`}>the machine&rsquo;s page</Link> (reg. 237), where each can name the profile it discharges.</p>
          : <Records assetId={a.id} orgId={orgId} today={today} records={records} profiles={profiles.filter((p) => p.active)} canAdd={canManage && a.active} />}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function EditAsset({ asset: a, isPlant, today }: { asset: AssetVerdict['asset']; isPlant: boolean; today: string }) {
  const save = useSave();
  const [cls, setCls] = useState<AssetClass>(a.asset_class);
  const [name, setName] = useState(a.name);
  const [assetNo, setAssetNo] = useState(a.asset_no ?? '');
  const [barcode, setBarcode] = useState(a.barcode ?? '');
  const [category, setCategory] = useState(a.category ?? '');
  const [makeModel, setMakeModel] = useState(a.make_model ?? '');
  const [serial, setSerial] = useState(a.serial_no ?? '');
  const [ownership, setOwnership] = useState<AssetOwnership>(a.ownership);
  const [supplier, setSupplier] = useState(a.supplier ?? '');
  const [hireRef, setHireRef] = useState(a.hire_ref ?? '');
  const [location, setLocation] = useState(a.location ?? '');
  const [purchased, setPurchased] = useState(a.purchased_on ?? '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const [retire, setRetire] = useState(!a.active);
  const [reason, setReason] = useState(a.retired_reason ?? '');

  async function saveIt() {
    if (!isPlant && !name.trim()) { save.setError('Give it a name.'); return; }
    if (retire && !reason.trim()) { save.setError('Say why it is retired.'); return; }
    await save.run('edit', async () => {
      const patch: Record<string, unknown> = {
        barcode: blankToNull(barcode), serial_no: blankToNull(serial), location: blankToNull(location), purchased_on: purchased || null, notes: blankToNull(notes),
      };
      if (!isPlant) Object.assign(patch, {
        asset_class: cls, name: name.trim(), asset_no: blankToNull(assetNo), category: blankToNull(category), make_model: blankToNull(makeModel),
        ownership, supplier: blankToNull(supplier), hire_ref: ownership === 'own' ? null : blankToNull(hireRef), active: !retire, retired_reason: retire ? reason.trim() : null,
      });
      else Object.assign(patch, { category: blankToNull(category) });
      const { error } = await createClient().from('assets').update(patch).eq('id', a.id);
      if (error) throw new Error(error.message);
    });
  }

  return (
    <div className="regs__form">
      <div className="regs__fields">
        {!isPlant && (
          <>
            <Field label="Class">
              <select className="field field--sm" value={cls} onChange={(e) => setCls(e.target.value as AssetClass)}>
                {ASSET_CLASSES.filter((c) => c !== 'plant').map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="Name" wide><input className="field field--sm" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Asset number"><input className="field field--sm" value={assetNo} onChange={(e) => setAssetNo(e.target.value)} /></Field>
            <Field label="Make and model"><input className="field field--sm" value={makeModel} onChange={(e) => setMakeModel(e.target.value)} /></Field>
            <Field label="Ownership">
              <select className="field field--sm" value={ownership} onChange={(e) => setOwnership(e.target.value as AssetOwnership)}>
                {ASSET_OWNERSHIP.map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
              </select>
            </Field>
            <Field label={ownership === 'own' ? 'Supplier' : 'Hired from / owner'}><input className="field field--sm" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
            {ownership !== 'own' && <Field label="Hire reference"><input className="field field--sm" value={hireRef} onChange={(e) => setHireRef(e.target.value)} /></Field>}
          </>
        )}
        {!isPlant && <Field label="Category"><input className="field field--sm" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>}
        <Field label="Barcode / tag"><input className="field field--sm" value={barcode} onChange={(e) => setBarcode(e.target.value)} /></Field>
        <Field label="Serial number"><input className="field field--sm" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Kept at"><input className="field field--sm" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Purchased / hired on"><input className="field field--sm" type="date" value={purchased} max={today} onChange={(e) => setPurchased(e.target.value)} /></Field>
        <Field label="Notes" wide><input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {!isPlant && (
        <div className="regs__ticks" style={{ marginTop: '0.6rem' }}>
          <label className="regs__tick"><input type="checkbox" checked={retire} onChange={(e) => setRetire(e.target.checked)} /> Retired — sold, scrapped, returned to the hirer, lost</label>
          {retire && <label className="fieldcell"><span className="label">Why</span><input className="field field--sm" value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        </div>
      )}
      {isPlant && <p className="caption">Its name, number, make, ownership and supplier are kept on the plant register; retire it there.</p>}
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions"><button type="button" className="button" disabled={save.busy !== null} onClick={() => void saveIt()}>{save.busy ? 'Saving…' : 'Save'}</button></div>
    </div>
  );
}

function CheckOut({ assetId, orgId, projectId, jobs, today, pending }: { assetId: string; orgId: string; projectId: string; jobs: Array<{ id: string; code: string; name: string }>; today: string; pending: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [holder, setHolder] = useState('');
  const [job, setJob] = useState(projectId);
  const [purpose, setPurpose] = useState('');
  const [dueBack, setDueBack] = useState('');
  const [condition, setCondition] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  async function go() {
    if (!holder.trim()) { setError('Name who has it.'); return; }
    setBusy(true); setError(null); setSaid(null);
    const id = outbox.newId();
    const row = { id, org_id: orgId, asset_id: assetId, project_id: job || null, holder_name: holder.trim(), purpose: blankToNull(purpose), due_back_on: dueBack || null, condition_out: blankToNull(condition) };
    try {
      const live = async () => {
        const { error: e } = await createClient().from('asset_checkouts').insert(row);
        if (e) throw new Error(/asset_checkouts_one_open/i.test(e.message) ? 'Someone else checked it out first. Reload the page.' : e.message);
      };
      const queue = () => outbox.enqueue({ kind: 'asset_checkout', projectId, subjectId: assetId, payload: { row } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setSaid(outcome === 'sent' ? `With ${row.holder_name}.` : `Saved on the phone — ${row.holder_name} has it; it goes when there is signal.`);
      setOpen(false); setHolder(''); setPurpose(''); setDueBack(''); setCondition('');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (pending) return <p className="notice" role="status">Checked out on this phone; it goes when there is signal.</p>;
  if (!open) return <><p className="caption">In — nobody has it checked out.</p>{said && <p className="notice" role="status">{said}</p>}<button type="button" className="button button--quiet" onClick={() => setOpen(true)}>Check it out</button></>;
  return (
    <div className="regs__form">
      <div className="regs__fields">
        <Field label="Who has it" wide><input className="field field--sm" value={holder} autoFocus placeholder="The name on the sheets" onChange={(e) => setHolder(e.target.value)} /></Field>
        <Field label="To which job">
          <select className="field field--sm" value={job} onChange={(e) => setJob(e.target.value)}>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} {j.name}</option>)}
            <option value="">Not a job — the yard, a ute, the office</option>
          </select>
        </Field>
        <Field label="Back by"><input className="field field--sm" type="date" value={dueBack} min={today} onChange={(e) => setDueBack(e.target.value)} /></Field>
        <Field label="For"><input className="field field--sm" value={purpose} placeholder="Optional" onChange={(e) => setPurpose(e.target.value)} /></Field>
        <Field label="Condition going out"><input className="field field--sm" value={condition} placeholder="Optional" onChange={(e) => setCondition(e.target.value)} /></Field>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="regs__actions">
        <button type="button" className="button" disabled={busy || !holder.trim()} onClick={() => void go()}>{busy ? 'Saving…' : 'Check it out'}</button>
        <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function CheckIn({ checkout, projectId, pending, canManage }: { checkout: NonNullable<AssetVerdict['custody']>; projectId: string; pending: boolean; canManage: boolean }) {
  const router = useRouter();
  const [condition, setCondition] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    const patch = { in_at: new Date().toISOString(), condition_in: blankToNull(condition) };
    try {
      const live = async () => {
        const { data, error: e } = await createClient().from('asset_checkouts').update(patch).eq('id', checkout.id).is('in_at', null).select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('It was already checked in, or this account cannot check it in.');
      };
      const queue = () => outbox.enqueue({ kind: 'asset_checkin', projectId, subjectId: checkout.id, payload: { patch } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setSaid(outcome === 'sent' ? 'Checked in.' : 'Checked in on this phone; it goes when there is signal.');
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const late = checkout.due_back_on != null && checkout.due_back_on < new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  return (
    <>
      <p className={late ? 'alert' : 'caption'}>
        With <strong>{checkout.holder_name}</strong>{checkout.project_code ? ` on ${checkout.project_code}` : ''} since {fmtPerthDate(checkout.out_at)}
        {checkout.due_back_on ? ` · back by ${fmtDate(checkout.due_back_on)}${late ? ' — late' : ''}` : ''}
      </p>
      {pending || said ? <p className="notice" role="status">{said ?? 'Checked in on this phone; it goes when there is signal.'}</p> : canManage && (
        <div className="regs__pick">
          <label className="fieldcell"><span className="label">Condition coming back</span><input className="field field--sm" value={condition} placeholder="Optional" onChange={(e) => setCondition(e.target.value)} /></label>
          <button type="button" className="button" disabled={busy} onClick={() => void go()}>{busy ? 'Saving…' : 'Check it in'}</button>
        </div>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </>
  );
}

function AddMeter({ assetId, projectId, today, latest }: { assetId: string; projectId: string; today: string; latest: MeterFacts | null }) {
  const router = useRouter();
  const [reading, setReading] = useState('');
  const [readOn, setReadOn] = useState(today);
  const [unit, setUnit] = useState<MeterUnit>('hours');
  const [replaced, setReplaced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  async function go() {
    const n = Number(reading);
    if (reading.trim() === '' || !Number.isFinite(n) || n < 0) { setError('The reading is a number.'); return; }
    if (latest && n < latest.reading && !replaced) { setError(`The meter read ${fmtHours(latest.reading)} on ${fmtDate(latest.read_on)}; a lower reading means a new meter — tick that it was replaced.`); return; }
    setBusy(true); setError(null); setSaid(null);
    const row = { id: outbox.newId(), asset_id: assetId, read_on: readOn, reading: n, unit, meter_replaced: replaced };
    try {
      const live = async () => { const { error: e } = await createClient().from('asset_meter_readings').insert(row); if (e) throw new Error(e.message); };
      const queue = () => outbox.enqueue({ kind: 'asset_meter', projectId, subjectId: assetId, payload: { row } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      setSaid(outcome === 'sent' ? `${fmtHours(n)} recorded.` : 'Saved on the phone; it goes when there is signal.');
      setReading(''); setReplaced(false);
      if (outcome === 'sent') router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="regs__form">
      <div className="regs__pick">
        <label className="fieldcell"><span className="label">Reading</span><input className="field field--sm" inputMode="decimal" value={reading} placeholder={latest ? `last ${fmtHours(latest.reading)}` : '—'} onChange={(e) => setReading(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Unit</span>
          <select className="field field--sm" value={unit} onChange={(e) => setUnit(e.target.value as MeterUnit)}>{METER_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        <label className="fieldcell"><span className="label">Read on</span><input className="field field--sm" type="date" value={readOn} max={today} onChange={(e) => setReadOn(e.target.value)} /></label>
        <button type="button" className="button" disabled={busy || !reading.trim()} onClick={() => void go()}>{busy ? 'Saving…' : 'Record it'}</button>
      </div>
      <label className="regs__tick"><input type="checkbox" checked={replaced} onChange={(e) => setReplaced(e.target.checked)} /> The meter was replaced — this reading starts again</label>
      {error && <p className="alert" role="alert">{error}</p>}
      {said && <p className="notice" role="status">{said}</p>}
    </div>
  );
}

function AddProfile({ asset, orgId, today, people, meter }: { asset: AssetVerdict['asset']; orgId: string; today: string; people: Array<{ id: string; name: string }>; meter: MeterFacts | null }) {
  const save = useSave();
  const presets = presetsFor(asset.asset_class);
  const [kind, setKind] = useState<ProfileKind>('inspection');
  const [label, setLabel] = useState('');
  const [basis, setBasis] = useState('');
  const [byDate, setByDate] = useState(true);
  const [every, setEvery] = useState('6');
  const [unit, setUnit] = useState<Unit>('month');
  const [firstDue, setFirstDue] = useState('');
  const [byHours, setByHours] = useState(false);
  const [everyHours, setEveryHours] = useState('250');
  const [startHours, setStartHours] = useState(meter ? String(meter.reading) : '');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<ActionPriority>('normal');
  const [notes, setNotes] = useState('');

  function usePreset(i: number) {
    const p = presets[i];
    if (!p) return;
    setKind(p.kind); setLabel(p.label); setBasis(p.basis);
    if (p.every != null && p.unit) { setByDate(true); setEvery(String(p.every)); setUnit(p.unit); } else setByDate(false);
    if (p.every_hours != null) { setByHours(true); setEveryHours(String(p.every_hours)); } else setByHours(false);
  }

  async function add() {
    if (!label.trim()) { save.setError('Say what falls due.'); return; }
    if (!byDate && !byHours) { save.setError('By the calendar, by the meter, or both.'); return; }
    const n = Number(every);
    if (byDate && (!Number.isInteger(n) || n < 1 || n > 365)) { save.setError('Every so many days, weeks or months — a whole number.'); return; }
    if (byDate && !firstDue) { save.setError('Say when it is first due.'); return; }
    const h = Number(everyHours); const sh = Number(startHours);
    if (byHours && (!Number.isFinite(h) || h <= 0)) { save.setError('Every so many hours — a number above zero.'); return; }
    if (byHours && (startHours.trim() === '' || !Number.isFinite(sh) || sh < 0)) { save.setError('The reading the cycle counts from — the meter now, or at the last service.'); return; }
    await save.run('profile', async () => {
      const { error } = await createClient().from('asset_profiles').insert({
        org_id: orgId, asset_id: asset.id, kind, label: label.trim(), basis: blankToNull(basis),
        every: byDate ? n : null, unit: byDate ? unit : null, first_due_on: byDate ? firstDue : null,
        every_hours: byHours ? h : null, start_hours: byHours ? sh : null,
        assigned_to: assignee || null, priority, notes: blankToNull(notes),
      });
      if (error) throw new Error(error.message);
      setLabel(''); setBasis(''); setFirstDue(''); setNotes('');
      return `${label.trim()} is set.`;
    });
  }

  return (
    <div className="regs__form">
      {presets.length > 0 && (
        <label className="fieldcell"><span className="label">Start from what this class usually needs</span>
          <select className="field field--sm" defaultValue="" onChange={(e) => { usePreset(Number(e.target.value)); e.target.value = ''; }}>
            <option value="">Pick one…</option>
            {presets.map((p, i) => <option key={p.label} value={i}>{p.label} — {describeProfile({ every: p.every ?? null, unit: p.unit ?? null, every_hours: p.every_hours ?? null })}</option>)}
          </select>
        </label>
      )}
      <div className="regs__fields">
        <Field label="What" wide><input className="field field--sm" value={label} placeholder="Test and tag; 6-monthly service; annual inspection" onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Kind">
          <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as ProfileKind)}>{PROFILE_KINDS.map((k) => <option key={k} value={k}>{PROFILE_KIND_LABEL[k]}</option>)}</select>
        </Field>
        <Field label="On what basis" wide><input className="field field--sm" value={basis} placeholder="The standard's clause, the manufacturer's schedule, the hirer's terms" onChange={(e) => setBasis(e.target.value)} /></Field>
      </div>
      <div className="regs__ticks" style={{ marginTop: '0.6rem' }}>
        <label className="regs__tick"><input type="checkbox" checked={byDate} onChange={(e) => setByDate(e.target.checked)} /> By the calendar</label>
        <label className="regs__tick"><input type="checkbox" checked={byHours} onChange={(e) => setByHours(e.target.checked)} /> By the meter</label>
      </div>
      {byDate && (
        <div className="regs__fields">
          <Field label="Every"><input className="field field--sm" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} /></Field>
          <Field label="Unit"><select className="field field--sm" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}><option value="day">days</option><option value="week">weeks</option><option value="month">months</option></select></Field>
          <Field label="First due"><input className="field field--sm" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
        </div>
      )}
      {byHours && (
        <div className="regs__fields">
          <Field label="Every (hours)"><input className="field field--sm" inputMode="decimal" value={everyHours} onChange={(e) => setEveryHours(e.target.value)} /></Field>
          <Field label="Counting from (reading)"><input className="field field--sm" inputMode="decimal" value={startHours} placeholder={meter ? `now ${fmtHours(meter.reading)}` : 'the meter at the last service'} onChange={(e) => setStartHours(e.target.value)} /></Field>
        </div>
      )}
      <div className="regs__fields" style={{ marginTop: '0.5rem' }}>
        <Field label="The action goes to">
          <select className="field field--sm" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Nobody in particular</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="field field--sm" value={priority} onChange={(e) => setPriority(e.target.value as ActionPriority)}>
            {(['normal', 'high', 'critical'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Notes" wide><input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <p className="caption">A week before it falls due the nightly sweep raises an action for it, which closes when the record is made. Next due counts from when it was last DONE, as the forms do; never from the calendar alone. Today is {fmtDate(today)}.</p>
      <Messages error={save.error} notice={save.notice} />
      <div className="regs__actions"><button type="button" className="button" disabled={save.busy !== null || !label.trim()} onClick={() => void add()}>{save.busy ? 'Saving…' : 'Set it'}</button></div>
    </div>
  );
}

function RetireProfile({ profile }: { profile: ProfileRow }) {
  const save = useSave();
  const [sure, setSure] = useState(false);
  if (!sure) return <button type="button" className="linklike" onClick={() => setSure(true)}>Retire</button>;
  return (
    <span className="regs__actions" style={{ marginTop: 0 }}>
      <button type="button" className="button button--quiet regs__edit" disabled={save.busy !== null} onClick={() => void save.run('retire', async () => {
        const { error } = await createClient().from('asset_profiles').update({ active: false }).eq('id', profile.id);
        if (error) throw new Error(error.message);
        return `${profile.label} retired.`;
      })}>Retire it</button>
      <button type="button" className="linklike" onClick={() => setSure(false)}>Keep</button>
    </span>
  );
}

function Records({ assetId, orgId, today, records, profiles, canAdd }: { assetId: string; orgId: string; today: string; records: AssetRecordRow[]; profiles: ProfileRow[]; canAdd: boolean }) {
  const save = useSave();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<AssetRecordKind>('inspection');
  const [profileId, setProfileId] = useState('');
  const [doneOn, setDoneOn] = useState(today);
  const [by, setBy] = useState('');
  const [competence, setCompetence] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [meter, setMeter] = useState('');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [findings, setFindings] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const paths = records.map((r) => r.file_path).filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('plant-records').createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [records]);

  async function add() {
    if (!by.trim()) { save.setError('Name who did it — the competent person.'); return; }
    const m = meter.trim() === '' ? null : Number(meter);
    if (m != null && (!Number.isFinite(m) || m < 0)) { save.setError('The meter reading is a number, or leave it blank.'); return; }
    const ok = await save.run('record', async () => {
      const supabase = createClient();
      const id = crypto.randomUUID();
      let filePath: string | null = null;
      if (file) {
        const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
        filePath = `${orgId}/${assetId}/${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('plant-records').upload(filePath, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
      }
      const { error } = await supabase.from('asset_records').insert({
        id, asset_id: assetId, profile_id: profileId || null, kind, done_on: doneOn, performed_by_name: by.trim(), competence: blankToNull(competence), organisation: blankToNull(organisation),
        meter_reading: m, outcome: outcome || null, findings: blankToNull(findings), next_due_on: nextDue || null, file_path: filePath,
      });
      if (error) {
        // The row was refused, so the file it names would be an orphan: remove exactly the path just uploaded.
        if (filePath) await supabase.storage.from('plant-records').remove([filePath]).catch(() => undefined);
        throw new Error(error.message);
      }
      return 'Recorded.';
    });
    if (ok) { setAdding(false); setBy(''); setCompetence(''); setOrganisation(''); setMeter(''); setOutcome(''); setFindings(''); setNextDue(''); setFile(null); setProfileId(''); }
  }

  const profileLabel = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.label ?? 'a retired profile' : null);
  return (
    <>
      {records.length === 0 && <p className="caption">Nothing on record yet.</p>}
      {records.length > 0 && (
        <ul className="regs__others">
          {records.map((r) => (
            <li key={r.id}>
              <strong>{RECORD_KIND_LABEL[r.kind]}</strong> · {fmtDate(r.done_on)} · {r.performed_by_name}{r.competence ? ` (${r.competence})` : ''}{r.organisation ? `, ${r.organisation}` : ''}
              {r.outcome ? ` · ${OUTCOME_LABEL[r.outcome]}` : ''}{r.meter_reading != null ? ` · ${fmtHours(r.meter_reading)}` : ''}
              {r.profile_id ? ` · discharges ${profileLabel(r.profile_id)}` : ''}{r.next_due_on ? ` · next due ${fmtDate(r.next_due_on)}` : ''}
              {r.findings ? <><br /><span className="caption">{r.findings}</span></> : null}
              {r.file_path && (urls[r.file_path] ? <> · <a className="linklike" href={urls[r.file_path]} target="_blank" rel="noreferrer">the report</a></> : ' · a report is attached')}
            </li>
          ))}
        </ul>
      )}
      {canAdd && !adding && <button type="button" className="button button--quiet" onClick={() => setAdding(true)}>Record an inspection, test or service</button>}
      {canAdd && adding && (
        <div className="regs__form">
          <div className="regs__fields">
            <Field label="What was done">
              <select className="field field--sm" value={kind} onChange={(e) => setKind(e.target.value as AssetRecordKind)}>{ASSET_RECORD_KINDS.map((k) => <option key={k} value={k}>{RECORD_KIND_LABEL[k]}</option>)}</select>
            </Field>
            {profiles.length > 0 && (
              <Field label="Discharges">
                <select className="field field--sm" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <option value="">Nothing scheduled — a one-off</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
            )}
            <Field label="Done on"><input className="field field--sm" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} /></Field>
            <Field label="Who did it" wide><input className="field field--sm" value={by} placeholder="The competent person" onChange={(e) => setBy(e.target.value)} /></Field>
            <Field label="Their competence"><input className="field field--sm" value={competence} placeholder="Licensed electrician; the hirer's technician" onChange={(e) => setCompetence(e.target.value)} /></Field>
            <Field label="Company"><input className="field field--sm" value={organisation} placeholder="Optional" onChange={(e) => setOrganisation(e.target.value)} /></Field>
            <Field label="Meter reading"><input className="field field--sm" inputMode="decimal" value={meter} placeholder="—" onChange={(e) => setMeter(e.target.value)} /></Field>
            <Field label="Outcome">
              <select className="field field--sm" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome | '')}>
                <option value="">Not stated</option>
                {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
              </select>
            </Field>
            <Field label="Next due, if the tag or inspector set it"><input className="field field--sm" type="date" value={nextDue} min={doneOn} onChange={(e) => setNextDue(e.target.value)} /></Field>
            <Field label="Findings" wide><input className="field field--sm" value={findings} onChange={(e) => setFindings(e.target.value)} /></Field>
          </div>
          <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
            {file ? `Chosen: ${file.name}` : 'Attach the report, tag photo or certificate (optional)'}
            <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Messages error={save.error} notice={null} />
          <div className="regs__actions">
            <button type="button" className="button" disabled={save.busy !== null || !by.trim()} onClick={() => void add()}>{save.busy === 'record' ? 'Recording…' : 'Record it'}</button>
            <button type="button" className="linklike" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          <p className="caption">Once recorded it cannot be changed. An open action for what it discharges closes with it.</p>
        </div>
      )}
      {!adding && <Messages error={save.error} notice={save.notice} />}
    </>
  );
}
