'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function AddSubcontractor({ orgId, projectId, userId }: { orgId: string; projectId: string; userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [trade, setTrade] = useState(''); const [abn, setAbn] = useState('');
  const [contact, setContact] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try {
      if (!name.trim()) throw new Error('The company name.');
      const supabase = createClient();
      const { data, error: e } = await supabase.from('subcontractors').insert({ org_id: orgId, name: name.trim(), trade: trade.trim() || null, abn: abn.trim() || null, contact_name: contact.trim() || null, contact_phone: phone.trim() || null, contact_email: email.trim() || null, created_by: userId }).select('id').single();
      if (e) throw new Error(/subcontractors_org_name_idx/.test(e.message) ? 'That company is already on the list.' : e.message);
      const { error: e2 } = await supabase.from('project_subcontractors').insert({ project_id: projectId, subcontractor_id: data.id, created_by: userId });
      if (e2) throw new Error(e2.message);
      router.push(`/subcontractors/${data.id}?project=${projectId}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); setBusy(false); }
  }
  if (!open) return <button type="button" className="button" onClick={() => setOpen(true)}>Add a subcontractor to this job</button>;
  return (
    <div className="item">
      <p className="label">New subcontractor</p>
      <label className="fieldcell"><span className="label">Company</span><input className="field field--sm" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Trade</span><input className="field field--sm" value={trade} placeholder="Plumbing, traffic control…" onChange={(e) => setTrade(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">ABN</span><input className="field field--sm" value={abn} onChange={(e) => setAbn(e.target.value)} /></label>
      </div>
      <label className="fieldcell"><span className="label">Contact</span><input className="field field--sm" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
      <div className="signin__grid">
        <label className="fieldcell"><span className="label">Phone</span><input className="field field--sm" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="fieldcell"><span className="label">Email</span><input className="field field--sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="photo-add-pair">
        <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Add and engage on this job'}</button>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
