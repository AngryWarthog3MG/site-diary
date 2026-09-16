'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { HAZARD_CLASSES, HAZARD_LABEL } from '@/lib/chemicals/model';

interface Props {
  projectId: string;
  orgId: string;
  userId: string;
  /** Supervisor or admin: keeps the company's product list and its sheets. */
  canKeepList: boolean;
  /** Gate duty: says what is on THIS site today. */
  canPutOnSite: boolean;
  products: Array<{ id: string; name: string; onJob: boolean }>;
}

/**
 * Two jobs on one screen, because they are two halves of the same sentence:
 * put a chemical the company already knows onto this site, or record one the
 * company has never used before. Nothing here is inferred — the hazard classes
 * are ticked from the label, never guessed from the product's name.
 */
export function ChemicalsScreen({ projectId, orgId, userId, canKeepList, canPutOnSite, products }: Props) {
  const router = useRouter();
  const [productId, setProductId] = useState('');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('');
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [dgClass, setDgClass] = useState('');
  const [usedFor, setUsedFor] = useState('');
  const [hazards, setHazards] = useState<string[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const off = products.filter((p) => !p.onJob);

  async function putOnSite(id: string, loc: string, qty: string) {
    setBusy('link');
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await createClient().from('project_chemicals').upsert({
        project_id: projectId, product_id: id,
        location: loc.trim() || null, quantity: qty.trim() || null,
        active: true, created_by: userId,
      });
      if (e) throw new Error(e.message);
      setProductId('');
      setLocation('');
      setQuantity('');
      setNotice('Added to this site.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function createProduct() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy('new');
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { data, error: e } = await supabase.from('chemical_products').insert({
        org_id: orgId, name: trimmed,
        manufacturer: manufacturer.trim() || null,
        dg_class: dgClass.trim() || null,
        used_for: usedFor.trim() || null,
        hazard_classes: hazards,
        created_by: userId,
      }).select('id').single();
      if (e) throw new Error(e.message);
      if (canPutOnSite && data?.id) {
        const { error: le } = await supabase.from('project_chemicals')
          .upsert({ project_id: projectId, product_id: data.id, location: location.trim() || null, quantity: quantity.trim() || null, active: true, created_by: userId });
        if (le) throw new Error(`Recorded, but not added to this site: ${le.message}`);
      }
      setName(''); setManufacturer(''); setDgClass(''); setUsedFor(''); setHazards([]);
      setLocation(''); setQuantity(''); setShowNew(false);
      setNotice('Recorded. Add its safety data sheet next — open it from the list above.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (!canPutOnSite && !canKeepList) return null;

  return (
    <section className="chemreg__add">
      <hr className="rule" />
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {canPutOnSite && (
        <>
          <p className="label">Put a chemical on this site</p>
          {off.length === 0 ? (
            <p className="caption">Everything the company keeps is already on this site.</p>
          ) : (
            <>
              <label className="fieldcell">
                <span className="label">Chemical</span>
                <select className="field field--sm" id="chem-pick" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Choose one…</option>
                  {off.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <div className="signin__grid">
                <label className="fieldcell">
                  <span className="label">Where it is kept</span>
                  <input className="field field--sm" id="chem-loc" value={location} placeholder="Compound, ute, bunded store" onChange={(e) => setLocation(e.target.value)} />
                </label>
                <label className="fieldcell">
                  <span className="label">How much</span>
                  <input className="field field--sm" id="chem-qty" value={quantity} placeholder="1000 L, 2 × 20 L" onChange={(e) => setQuantity(e.target.value)} />
                </label>
              </div>
              <button type="button" className="button" disabled={busy !== null || !productId} onClick={() => void putOnSite(productId, location, quantity)}>
                {busy === 'link' ? 'Adding…' : 'Add to this site'}
              </button>
            </>
          )}
        </>
      )}

      {canKeepList && (
        <>
          <hr className="rule" />
          {!showNew ? (
            <button type="button" className="button button--quiet" onClick={() => setShowNew(true)}>
              Record a chemical the company has not used before
            </button>
          ) : (
            <>
              <p className="label">A chemical the company has not used before</p>
              <p className="caption">Copy what the label and the sheet say. Nothing here is worked out for you.</p>
              <label className="fieldcell">
                <span className="label">Product name</span>
                <input className="field field--sm" id="chem-name" value={name} placeholder="Diesel, Roundup Biactive, Loctite 243" onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="signin__grid">
                <label className="fieldcell">
                  <span className="label">Manufacturer or supplier</span>
                  <input className="field field--sm" id="chem-maker" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
                </label>
                <label className="fieldcell fieldcell--narrow">
                  <span className="label">Dangerous goods class</span>
                  <input className="field field--sm" id="chem-dg" value={dgClass} placeholder="3, 8, none" onChange={(e) => setDgClass(e.target.value)} />
                </label>
              </div>
              <label className="fieldcell">
                <span className="label">What it is used for</span>
                <input className="field field--sm" id="chem-use" value={usedFor} placeholder="Refuelling plant, spraying the batters" onChange={(e) => setUsedFor(e.target.value)} />
              </label>
              <p className="label" style={{ marginTop: '0.75rem' }}>Hazards on the label</p>
              <div className="crewchips">
                {HAZARD_CLASSES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`quotebtn crewchip${hazards.includes(h) ? ' crewchip--on' : ''}`}
                    onClick={() => setHazards((v) => (v.includes(h) ? v.filter((x) => x !== h) : [...v, h]))}
                  >
                    {HAZARD_LABEL[h]}
                  </button>
                ))}
              </div>
              <button type="button" className="button" disabled={busy !== null || !name.trim()} onClick={() => void createProduct()}>
                {busy === 'new' ? 'Recording…' : canPutOnSite ? 'Record it and put it on this site' : 'Record it'}
              </button>
              <button type="button" className="linklike" onClick={() => setShowNew(false)}>Cancel</button>
            </>
          )}
        </>
      )}
    </section>
  );
}
