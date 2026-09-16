'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import {
  currentSds, sdsReviewDue, sdsStatus, SDS_STATUS_LABEL, hazardLabel, sdsNeedsAttention,
  type SdsFacts,
} from '@/lib/chemicals/model';

interface Product {
  id: string;
  orgId: string;
  name: string;
  manufacturer: string | null;
  hazardClasses: string[];
  dgClass: string | null;
  usedFor: string | null;
  active: boolean;
  sheets: SdsFacts[];
}

interface Props {
  product: Product;
  projectId: string;
  userId: string;
  today: string;
  onThisJob: { location: string | null; quantity: string | null } | null;
  elsewhere: string[];
  canKeepList: boolean;
  canPutOnSite: boolean;
}

/**
 * The sheets for one chemical, newest first, and the one the register is
 * holding. Adding a sheet uploads the file first and records the row second,
 * removing the file if the row fails — a sheet the register does not point at
 * is as good as lost, and one pointing at nothing is worse than none.
 */
export function ProductScreen({ product, projectId, userId, today, onThisJob, elsewhere, canKeepList, canPutOnSite }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState('');
  const [version, setVersion] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState(onThisJob?.location ?? '');
  const [quantity, setQuantity] = useState(onThisJob?.quantity ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sheets = [...product.sheets].sort((a, b) => b.issued_on.localeCompare(a.issued_on));
  const held = currentSds(product.sheets);
  const status = sdsStatus(product.sheets, today);

  useEffect(() => {
    const paths = sheets.map((s) => s.file_path).filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('chemical-sds').createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, product.sheets.length]);

  async function addSheet() {
    if (!issued) { setError('Put the date printed on the sheet in.'); return; }
    setBusy('sds');
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const id = crypto.randomUUID();
    let filePath: string | null = null;
    try {
      if (file) {
        const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
        filePath = `${product.orgId}/${product.id}/${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('chemical-sds')
          .upload(filePath, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
      }
      const { error: e } = await supabase.from('chemical_sds')
        .insert({ id, product_id: product.id, issued_on: issued, version: version.trim() || null, file_path: filePath, created_by: userId });
      if (e) {
        if (filePath) await supabase.storage.from('chemical-sds').remove([filePath]).catch(() => undefined);
        throw new Error(e.message);
      }
      // The newest sheet is the one the register holds; the others are history.
      const older = sheets.filter((s) => s.active && s.issued_on <= issued).map((s) => s.id);
      if (older.length > 0) await supabase.from('chemical_sds').update({ active: false }).in('id', older);
      setIssued(''); setVersion(''); setFile(null);
      setNotice('Sheet recorded. It is now the one the register holds.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sheet did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function saveOnSite(active: boolean) {
    setBusy('site');
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await createClient().from('project_chemicals').upsert({
        project_id: projectId, product_id: product.id,
        location: location.trim() || null, quantity: quantity.trim() || null,
        active, created_by: userId,
      });
      if (e) throw new Error(e.message);
      setNotice(active ? 'Saved.' : 'Taken off this site. It stays in the company list.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className={`item ${sdsNeedsAttention(status) ? 'item--warn' : ''}`}>
        <p className="label">The sheet the register is holding</p>
        <p style={{ margin: '0.3rem 0 0', fontWeight: 600 }} className={sdsNeedsAttention(status) ? 'vr-missing' : undefined}>
          {SDS_STATUS_LABEL[status]}
        </p>
        {held && (
          <p className="caption">
            Issued {fmtDate(held.issued_on)}{held.version ? ` · version ${held.version}` : ''} · review by {fmtDate(sdsReviewDue(held))}
            {held.file_path && urls[held.file_path] ? <> · <a href={urls[held.file_path]} target="_blank" rel="noopener">open the sheet</a></> : held.file_path ? ' · file loading…' : ' · no file attached'}
          </p>
        )}
        {product.hazardClasses.length > 0 && (
          <p className="caption">{product.hazardClasses.map(hazardLabel).join(' · ')}{product.dgClass ? ` · DG class ${product.dgClass}` : ''}</p>
        )}
      </div>

      {canPutOnSite && (
        <>
          <hr className="rule" />
          <p className="label">{onThisJob ? 'On this site' : 'Not on this site'}</p>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">Where it is kept</span>
              <input className="field field--sm" id="prod-loc" value={location} placeholder="Compound, ute, bunded store" onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="fieldcell">
              <span className="label">How much</span>
              <input className="field field--sm" id="prod-qty" value={quantity} placeholder="1000 L, 2 × 20 L" onChange={(e) => setQuantity(e.target.value)} />
            </label>
          </div>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void saveOnSite(true)}>
            {busy === 'site' ? 'Saving…' : onThisJob ? 'Save where it is kept' : 'Put it on this site'}
          </button>
          {onThisJob && (
            <button type="button" className="linklike" disabled={busy !== null} onClick={() => void saveOnSite(false)}>
              It has left this site
            </button>
          )}
        </>
      )}

      {elsewhere.length > 0 && <p className="caption" style={{ marginTop: '0.75rem' }}>Also on {elsewhere.join(', ')}.</p>}

      <hr className="rule" />
      <p className="label">Safety data sheets</p>
      {sheets.length === 0 ? (
        <p className="nil">No sheet recorded. Until there is one, this chemical should not be on site.</p>
      ) : (
        <ul className="gaplist">
          {sheets.map((s) => (
            <li key={s.id}>
              Issued {fmtDate(s.issued_on)}{s.version ? ` · version ${s.version}` : ''}
              {s.active ? ' · current' : ' · superseded'}
              {s.file_path && urls[s.file_path] ? <> · <a href={urls[s.file_path]} target="_blank" rel="noopener">open</a></> : s.file_path ? '' : ' · no file'}
            </li>
          ))}
        </ul>
      )}

      {canKeepList && (
        <div className="item" style={{ marginTop: '0.9rem' }}>
          <p className="label">Add a sheet</p>
          <p className="caption">A newer sheet supersedes the one being held. The old one is kept, never deleted.</p>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">Date printed on the sheet</span>
              <input className="field field--sm" id="sds-issued" type="date" value={issued} max={today} onChange={(e) => setIssued(e.target.value)} />
            </label>
            <label className="fieldcell fieldcell--narrow">
              <span className="label">Version</span>
              <input className="field field--sm" id="sds-version" value={version} placeholder="Optional" onChange={(e) => setVersion(e.target.value)} />
            </label>
          </div>
          <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
            {file ? `Chosen: ${file.name}` : 'Choose the sheet (PDF or photo)'}
            <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="button" disabled={busy !== null || !issued} onClick={() => void addSheet()}>
            {busy === 'sds' ? 'Recording…' : 'Record this sheet'}
          </button>
        </div>
      )}
    </>
  );
}
