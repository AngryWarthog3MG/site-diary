'use client';

import { useEffect, useState } from 'react';
import { SignaturePad } from '@/components/signature-pad';
import { GATE_KINDS, GATE_KIND_LABEL, type GateKind } from '@/lib/gate/model';

interface Props { token: string; projectName: string; rules: string }
interface Remembered { id: string; name: string; at: string; date: string }

const KEY = 'site-diary-gate';

/**
 * The visitor's side of the gate. Their phone remembers today's sign-in so
 * the same page offers "sign out" on the way back through; the sign-in id
 * is the only key to it, and it is only ever on that phone.
 */
export function GateForm({ token, projectName, rules }: Props) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<GateKind>('visitor');
  const [contact, setContact] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Remembered | null>(null);
  const [done, setDone] = useState<'in' | 'out' | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${KEY}:${token}`);
      if (!raw) return;
      const r = JSON.parse(raw) as Remembered;
      if (r.date === new Date().toDateString()) setCurrent(r);
      else localStorage.removeItem(`${KEY}:${token}`);
    } catch { /* a phone with no storage still signs in */ }
  }, [token]);

  async function signIn(sig: Blob | null) {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.set('name', name); form.set('company', company); form.set('kind', kind); form.set('contact', contact); form.set('acknowledged', acknowledged ? 'true' : 'false');
      form.set('at', new Date().toISOString());
      if (sig) form.set('signature', sig, 'signature.png');
      const res = await fetch(`/api/gate/${token}/signin`, { method: 'POST', body: form });
      const body = (await res.json()) as { id?: string; error?: { message?: string } };
      if (!res.ok || !body.id) throw new Error(body.error?.message ?? 'The sign-in did not go through. Ask at the site office.');
      const r: Remembered = { id: body.id, name: name.trim(), at: new Date().toISOString(), date: new Date().toDateString() };
      try { localStorage.setItem(`${KEY}:${token}`, JSON.stringify(r)); } catch { /* fine */ }
      setCurrent(r); setDone('in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The sign-in did not go through.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/gate/${token}/signout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: current.id, at: new Date().toISOString() }) });
      const body = (await res.json()) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? 'The sign-out did not go through. Tell the site office you have left.');
      try { localStorage.removeItem(`${KEY}:${token}`); } catch { /* fine */ }
      setCurrent(null); setDone('out');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The sign-out did not go through.');
    } finally { setBusy(false); }
  }

  if (done === 'out') {
    return <div className="item"><p className="label">Signed out</p><p>Thanks — you are off the register for {projectName}. Safe travels.</p></div>;
  }
  if (current) {
    return (
      <div className="item">
        <p className="label">{done === 'in' ? 'Signed in' : 'You are signed in'}</p>
        <p><strong>{current.name}</strong> · since {new Date(current.at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Perth' })}</p>
        <p className="way-hint">{done === 'in' ? 'Report to the site supervisor. ' : ''}When you leave, open this code again and sign out.</p>
        {error && <p className="alert" role="alert">{error}</p>}
        <button type="button" className="button" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out — I am leaving'}</button>
      </div>
    );
  }
  return (
    <div className="gate-form">
      <label className="fieldcell"><span className="label">Your name</span><input className="field field--sm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="fieldcell"><span className="label">Company</span><input className="field field--sm" autoComplete="organization" value={company} placeholder="Optional" onChange={(e) => setCompany(e.target.value)} /></label>
      <div className="fitrow">
        <span className="label">Here as</span>
        <div className="crewchips">
          {GATE_KINDS.map((k) => <button key={k} type="button" className={`quotebtn crewchip${kind === k ? ' crewchip--on' : ''}`} onClick={() => setKind(k)}>{GATE_KIND_LABEL[k]}</button>)}
        </div>
      </div>
      <label className="fieldcell"><span className="label">Mobile</span><input className="field field--sm" type="tel" autoComplete="tel" value={contact} placeholder="So we can reach you in an emergency" onChange={(e) => setContact(e.target.value)} /></label>
      <div className="item">
        <p className="label">Site rules</p>
        <ul className="gate-rules">{rules.split('\n').filter(Boolean).map((r, i) => <li key={i}>{r}</li>)}</ul>
        <label className={`checkrow${acknowledged ? ' checkrow--on' : ''}`}>
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>I have read the site rules and will follow them and the supervisor&rsquo;s instructions.</span>
        </label>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="sigslot item">
        <p className="label">Sign with a finger</p>
        <SignaturePad disabled={busy || !acknowledged || name.trim().length < 2} saving={busy} onSave={(b) => void signIn(b)} />
      </div>
    </div>
  );
}
