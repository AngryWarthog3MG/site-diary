'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  ASSET_CLASSES, ASSET_OWNERSHIP, CLASS_HINT, CLASS_LABEL, DUE_LABEL, OWNERSHIP_LABEL, assetMatches, categoryLabel, custodySays, sortVerdicts, summarise,
  type AssetClass, type AssetOwnership, type AssetVerdict,
} from '@/lib/assets/model';
import { printHref } from '@/lib/registers/select';
import { fmtDay } from '@/lib/registers/model';
import { Field, Messages, PickBox, PrintBar, blankToNull, usePick, useSave } from '../registers/shared';

interface Props {
  orgId: string; projectId: string; jobCode: string; today: string;
  verdicts: AssetVerdict[]; onJob: string[]; canManage: boolean;
  initialQuery: string; initialClass: string;
}

const fmtHours = (n: number) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 1 })} h`;

/**
 * The asset register on screen (README R186): the counts, a finder, the list — overdue first —
 * and one way to add something that is not a machine. A machine is added on the Plant screen and
 * appears here on its own. Print the register, or QR labels for the ticked ones.
 */
export function AssetsScreen({ orgId, projectId, jobCode, today, verdicts, onJob, canManage, initialQuery, initialClass }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [cls, setCls] = useState<AssetClass | null>(ASSET_CLASSES.includes(initialClass as AssetClass) ? (initialClass as AssetClass) : null);
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const sorted = useMemo(() => sortVerdicts(verdicts), [verdicts]);
  const shown = useMemo(() => sorted.filter((v) => (showRetired || v.asset.active) && assetMatches(v, query, cls)), [sorted, query, cls, showRetired]);
  const s = summarise(verdicts);
  const counts = useMemo(() => {
    const m = new Map<AssetClass, number>();
    for (const v of verdicts) if (v.asset.active) m.set(v.asset.asset_class, (m.get(v.asset.asset_class) ?? 0) + 1);
    return m;
  }, [verdicts]);
  const all = useMemo(() => verdicts.filter((v) => v.asset.active).map((v) => v.asset.id), [verdicts]);
  const pick = usePick(all);
  const q = `?project=${projectId}`;

  return (
    <div className="regs">
      <div className="regs__counts">
        <p><strong>{s.inService}</strong> in service{s.retired ? ` · ${s.retired} retired` : ''} · {s.hired} hired in or a third party&rsquo;s · {s.out} checked out</p>
        <p>
          {s.overdue > 0 ? <strong style={{ color: '#9a2f2f' }}>{s.overdue} overdue</strong> : '0 overdue'}
          {' · '}{s.dueSoon} due within 30 days{' · '}{s.noProfile} with nothing set to fall due
        </p>
      </div>

      <PrintBar pdf="/api/assets/register/pdf" projectId={projectId} pick={pick} all={all} onJob={onJob} jobCode={jobCode} />
      <p className="regs__links">
        {pick.list.length > 0
          ? <a className="linklike" href={printHref('/api/assets/labels', projectId, { ids: pick.list })} target="_blank" rel="noreferrer">QR labels for the {pick.list.length} ticked</a>
          : <span className="caption">Tick assets to print QR labels for them — a scan opens the asset&rsquo;s page.</span>}
      </p>

      {canManage && (adding
        ? <AddAssetForm orgId={orgId} today={today} onDone={() => setAdding(false)} />
        : <button type="button" className="button" onClick={() => setAdding(true)}>Add an asset</button>)}

      <div className="photolib-finder" style={{ marginTop: '1rem' }}>
        <input
          className="field"
          inputMode="search"
          placeholder="Find an asset — its name, number, barcode, serial, make, where it is kept, who has it"
          aria-label="Find an asset"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <nav className="chips chips--compact" aria-label="Class of asset">
          <button type="button" className={`chip${cls == null ? ' chip--on' : ''}`} onClick={() => setCls(null)}>All · {s.inService}</button>
          {ASSET_CLASSES.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
            <button key={c} type="button" className={`chip${cls === c ? ' chip--on' : ''}`} onClick={() => setCls(cls === c ? null : c)}>{CLASS_LABEL[c]} · {counts.get(c)}</button>
          ))}
        </nav>
        {s.retired > 0 && (
          <label className="regs__tick"><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show the {s.retired} retired</label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="notice" style={{ marginTop: '1rem' }}>
          {verdicts.length === 0 ? 'Nothing is on the register yet. Add an asset above; the machines on the plant register appear here on their own.' : 'No asset matches that.'}
        </p>
      ) : (
        <div className="regs__list" style={{ marginTop: '1rem' }}>
          {shown.map((v) => <AssetRow key={v.asset.id} v={v} today={today} q={q} pick={pick} />)}
        </div>
      )}
    </div>
  );
}

function AssetRow({ v, today, q, pick }: { v: AssetVerdict; today: string; q: string; pick: ReturnType<typeof usePick> }) {
  const a = v.asset;
  const who = custodySays(v.custody, today);
  const tone = v.profiles.length === 0 ? '' : v.status === 'overdue' ? ' regs__fact--bad' : v.status === 'due_soon' ? ' regs__fact--warn' : ' regs__fact--ok';
  return (
    <article className={`card regs__row${a.active ? '' : ' regs__row--retired'}`}>
      <div className="regs__head">
        {a.active && <PickBox id={a.id} pick={pick} label={a.name} />}
        <div className="regs__title">
          <p className="regs__name"><Link href={`/assets/${a.id}${q}`}>{a.name}</Link>{a.asset_no ? <span className="review-muted"> · {a.asset_no}</span> : null}</p>
          <p className="regs__meta caption">
            {[CLASS_LABEL[a.asset_class], categoryLabel(a), a.make_model, OWNERSHIP_LABEL[a.ownership] + (a.supplier ? ` from ${a.supplier}` : ''), a.location ? `kept at ${a.location}` : null].filter(Boolean).join(' · ')}
            {!a.active && <> · <strong>Retired</strong>{a.retired_reason ? ` — ${a.retired_reason}` : ''}</>}
          </p>
        </div>
        <Link className="button button--quiet regs__edit" href={`/assets/${a.id}${q}`}>Open</Link>
      </div>
      <div className="regs__facts">
        <span className={`regs__fact${tone}`}>
          <span className="regs__fact-label">Next due</span>
          <span className="regs__fact-text">{v.profiles.length === 0 ? 'Nothing set' : v.next?.due ? fmtDay(v.next.due) : v.next?.dueAt != null ? `at ${fmtHours(v.next.dueAt)}` : '—'}</span>
          <span className="regs__fact-sub">{v.next ? `${v.next.profile.label} · ${DUE_LABEL[v.status]}${v.profiles.length > 1 ? ` · ${v.profiles.length} profiles` : ''}` : 'No inspection or service profile'}</span>
        </span>
        <span className={`regs__fact${v.custody ? (who.tone === 'bad' ? ' regs__fact--bad' : ' regs__fact--ok') : ''}`}>
          <span className="regs__fact-label">Custody</span>
          <span className="regs__fact-text">{who.text}</span>
        </span>
        {v.meter && (
          <span className="regs__fact">
            <span className="regs__fact-label">Meter</span>
            <span className="regs__fact-text">{fmtHours(v.meter.reading)}</span>
            <span className="regs__fact-sub">{fmtDay(v.meter.read_on)} · {v.meter.source === 'prestart' ? 'prestart' : v.meter.source === 'service' ? 'service record' : 'read by hand'}</span>
          </span>
        )}
      </div>
    </article>
  );
}

/** Adding something that is not a machine. A machine goes on the plant register (the Plant screen) and lands here by itself. */
function AddAssetForm({ orgId, today, onDone }: { orgId: string; today: string; onDone: () => void }) {
  const save = useSave();
  const [cls, setCls] = useState<AssetClass>('electrical');
  const [name, setName] = useState('');
  const [assetNo, setAssetNo] = useState('');
  const [barcode, setBarcode] = useState('');
  const [category, setCategory] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [serial, setSerial] = useState('');
  const [ownership, setOwnership] = useState<AssetOwnership>('own');
  const [supplier, setSupplier] = useState('');
  const [hireRef, setHireRef] = useState('');
  const [location, setLocation] = useState('');
  const [purchased, setPurchased] = useState('');
  const [notes, setNotes] = useState('');

  async function add() {
    if (!name.trim()) { save.setError('Give it a name.'); return; }
    const ok = await save.run('add', async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from('assets').insert({
        org_id: orgId, asset_class: cls, name: name.trim(), asset_no: blankToNull(assetNo), barcode: blankToNull(barcode), category: blankToNull(category),
        make_model: blankToNull(makeModel), serial_no: blankToNull(serial), ownership, supplier: blankToNull(supplier), hire_ref: ownership === 'own' ? null : blankToNull(hireRef),
        location: blankToNull(location), purchased_on: purchased || null, notes: blankToNull(notes), created_by: auth.user?.id,
      });
      if (error) throw new Error(error.message);
      return `${name.trim()} is on the register.`;
    });
    if (ok) onDone();
  }

  return (
    <div className="card regs__form">
      <p className="label">Add an asset</p>
      <div className="regs__fields">
        <Field label="Class">
          <select className="field field--sm" value={cls} onChange={(e) => setCls(e.target.value as AssetClass)}>
            {ASSET_CLASSES.filter((c) => c !== 'plant').map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Name" wide><input className="field field--sm" value={name} autoFocus placeholder="9 kg ABE extinguisher — site office; 15 m extension lead; 2 t chain sling" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Asset number"><input className="field field--sm" value={assetNo} placeholder="Yours, e.g. EXT-004" onChange={(e) => setAssetNo(e.target.value)} /></Field>
        <Field label="Barcode / tag"><input className="field field--sm" value={barcode} placeholder="If it carries one" onChange={(e) => setBarcode(e.target.value)} /></Field>
        <Field label="Category"><input className="field field--sm" value={category} placeholder="Extension lead, power board, RCD…" onChange={(e) => setCategory(e.target.value)} /></Field>
        <Field label="Make and model"><input className="field field--sm" value={makeModel} onChange={(e) => setMakeModel(e.target.value)} /></Field>
        <Field label="Serial number"><input className="field field--sm" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Ownership">
          <select className="field field--sm" value={ownership} onChange={(e) => setOwnership(e.target.value as AssetOwnership)}>
            {ASSET_OWNERSHIP.map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
          </select>
        </Field>
        <Field label={ownership === 'own' ? 'Supplier' : 'Hired from / owner'}><input className="field field--sm" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        {ownership !== 'own' && <Field label="Hire reference"><input className="field field--sm" value={hireRef} placeholder="Their docket or contract number" onChange={(e) => setHireRef(e.target.value)} /></Field>}
        <Field label="Kept at"><input className="field field--sm" value={location} placeholder="Site office; ute 2; the yard" onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Purchased / hired on"><input className="field field--sm" type="date" value={purchased} max={today} onChange={(e) => setPurchased(e.target.value)} /></Field>
        <Field label="Notes" wide><input className="field field--sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <p className="caption">{CLASS_HINT[cls]}. What falls due on it — a test and tag, a six-monthly service — is set on its page once it is on the register.</p>
      <Messages error={save.error} notice={null} />
      <div className="regs__actions">
        <button type="button" className="button" disabled={save.busy !== null || !name.trim()} onClick={() => void add()}>{save.busy ? 'Adding…' : 'Add it'}</button>
        <button type="button" className="linklike" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
