'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** The office brings an issued ITP template onto the job as a draft instance (README R164). */
export function BringOnItp({ projectId, headContractor, templates }: { projectId: string; headContractor: string | null; templates: Array<{ id: string; code: string; revision: string; title: string }> }) {
  const router = useRouter();
  const [pick, setPick] = useState(templates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function bring() {
    if (!pick) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await createClient().from('qa_itp_instances').insert({ project_id: projectId, template_id: pick, status: 'draft', issued_to: headContractor });
      if (e) throw new Error(/row-level security/i.test(e.message) ? 'Only the office brings an ITP onto a job.' : e.message);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="item qa-bring">
      <p className="label">Bring an inspection and test plan onto this job</p>
      <div className="dw-rates__form">
        <select className="field field--sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Which ITP">
          {templates.map((t) => <option key={t.id} value={t.id}>{t.code} Rev {t.revision} — {t.title}</option>)}
        </select>
        <button type="button" className="button button--quiet" disabled={busy || !pick} onClick={() => void bring()}>{busy ? 'Saving…' : 'Bring it on'}</button>
      </div>
      {error && <p className="alert">{error}</p>}
      <p className="caption">It arrives as a draft. Issue it to the head contractor, record their approval, and the crew records against its ITRs.</p>
    </div>
  );
}

/** Where the ITP stands on the job, moved forward by the office: issued, approved (by whom, when), signed. */
export function ItpStatusActions({ instanceId, status, headContractor }: { instanceId: string; status: 'draft' | 'issued' | 'approved' | 'signed'; headContractor: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [name, setName] = useState('');
  const [on, setOn] = useState('');
  async function move(patch: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const { data, error: e } = await createClient().from('qa_itp_instances').update(patch).eq('id', instanceId).select('id');
      if (e) throw new Error(/row-level security/i.test(e.message) ? 'Only the office moves an ITP forward.' : e.message);
      if (!data?.length) throw new Error('That did not save.');
      setApproving(false);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="qa-status">
      {status === 'draft' && <button type="button" className="button button--quiet" disabled={busy} onClick={() => void move({ status: 'issued', issued_to: headContractor })}>{busy ? 'Saving…' : `Issue to ${headContractor ?? 'the head contractor'}`}</button>}
      {status === 'issued' && !approving && <button type="button" className="button button--quiet" disabled={busy} onClick={() => setApproving(true)}>Record their approval</button>}
      {status === 'issued' && approving && (
        <form className="dw-rates__form" onSubmit={(e) => { e.preventDefault(); if (name.trim() && on) void move({ status: 'approved', approved_by_name: name.trim(), approved_at: `${on}T00:00:00+08:00` }); }}>
          <input className="field field--sm" placeholder="Approved by (name)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Approved by" />
          <input className="field field--sm" type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="Approved on" />
          <button type="submit" className="button button--quiet" disabled={busy || !name.trim() || !on}>Save</button>
          <button type="button" className="quotebtn" onClick={() => setApproving(false)}>Cancel</button>
        </form>
      )}
      {status === 'approved' && <button type="button" className="button button--quiet" disabled={busy} onClick={() => void move({ status: 'signed' })}>{busy ? 'Saving…' : 'Mark signed off at completion'}</button>}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}
