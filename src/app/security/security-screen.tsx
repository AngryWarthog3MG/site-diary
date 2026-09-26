'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Aal } from '@/lib/auth';

type Factor = { id: string; friendly_name?: string | null; created_at: string; status: string; factor_type: string };
type Enrolling = { factorId: string; qr: string; secret: string };

const FRIENDLY = 'Kooboolong IMS';
const fmt = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const grouped = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

/**
 * Setting up, and removing, the authenticator (README R106). Set up: a QR to scan (or the key to type), then the
 * first code, which proves the phone has it — the session is then at the second level and the money opens. Removing
 * needs a code-verified session, as Supabase requires.
 */
export function SecurityScreen({ aal, next }: { aal: Aal; next: string | null }) {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().auth.mfa.listFactors();
    if (err) { setError(err.message); setFactors([]); return; }
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.factor_type === 'totp'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const verified = (factors ?? []).filter((f) => f.status === 'verified');

  async function start() {
    setBusy(true); setError(null); setDone(null);
    try {
      const supabase = createClient();
      // A set-up that was started and never finished is cleared first, or the new one is refused.
      for (const f of (factors ?? []).filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: FRIENDLY });
      if (err || !data) throw new Error(err?.message ?? 'Could not start the set-up.');
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the set-up.'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!enrolling) return;
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) { setError('The code is the six digits the app shows now.'); return; }
    setBusy(true); setError(null);
    try {
      const { error: err } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: clean });
      if (err) throw new Error(/invalid|expired/i.test(err.message) ? 'That code did not match. Codes change every 30 seconds — try the one showing now.' : err.message);
      setEnrolling(null); setCode('');
      setDone('Two-factor sign-in is on. The money is open for this session.');
      await load();
      router.refresh();
      if (next) router.replace(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  }

  async function remove(factorId: string) {
    setBusy(true); setError(null); setDone(null);
    try {
      const { error: err } = await createClient().auth.mfa.unenroll({ factorId });
      if (err) throw new Error(/aal2|assurance/i.test(err.message) ? 'Enter your code first — removing two-factor needs it.' : err.message);
      setRemoving(false);
      setDone('Two-factor sign-in is off. The money is hidden until you set it up again.');
      await load();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!enrolling) return;
    try { await navigator.clipboard.writeText(enrolling.secret); setDone('Key copied.'); } catch { setDone('Select the key and copy it.'); }
  }

  if (factors === null) return <p className="caption">Checking…</p>;

  return (
    <div className="security">
      {error && <p className="alert">{error}</p>}
      {done && <p className="notice">{done}</p>}

      {verified.length > 0 && !enrolling && (
        <section className="security__status">
          <p className="security__on"><span className="security__dot security__dot--on" aria-hidden /> <strong>On</strong> · set up {fmt(verified[0].created_at)}</p>
          {aal.current !== 'aal2' ? (
            <p>This session signed in with the email link only. <Link href={`/security/verify${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Enter your code</Link> to open the money.</p>
          ) : (
            <p className="caption">This session has entered its code.</p>
          )}
          <p className="caption">Lost your phone? Ask another admin to reset your two-factor on Who is on this job, then set it up again.</p>
          {aal.current === 'aal2' && (removing ? (
            <div className="claims-actions">
              <button type="button" className="button button--quiet" disabled={busy} onClick={() => void remove(verified[0].id)}>{busy ? 'Removing…' : 'Yes, turn it off'}</button>
              <button type="button" className="button button--quiet" disabled={busy} onClick={() => setRemoving(false)}>Keep it on</button>
            </div>
          ) : (
            <button type="button" className="linklike" onClick={() => setRemoving(true)}>Turn two-factor off</button>
          ))}
        </section>
      )}

      {verified.length === 0 && !enrolling && (
        <section className="security__setup">
          <ol className="security__steps">
            <li>Put an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or 1Password all work.</li>
            <li>Tap below, then scan the square code with the app.</li>
            <li>Type the six digits the app shows.</li>
          </ol>
          <button type="button" className="button" disabled={busy} onClick={() => void start()}>{busy ? 'Starting…' : 'Set up two-factor sign-in'}</button>
        </section>
      )}

      {enrolling && (
        <section className="security__enrol">
          <p className="label">1 · Scan this with the app</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="security__qr" src={enrolling.qr} alt="QR code for your authenticator app" width={200} height={200} />
          <p className="caption">Can’t scan? Add an account in the app and type this key:</p>
          <p className="security__secret mono" id="security-secret">{grouped(enrolling.secret)}</p>
          <button type="button" className="linklike" onClick={() => void copy()}>Copy the key</button>
          <label className="fieldcell" htmlFor="security-code" style={{ marginTop: '1rem' }}>
            <span className="label">2 · The six digits the app shows</span>
            <input id="security-code" className="field security__code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} placeholder="123456"
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void confirm(); }} />
          </label>
          <div className="claims-actions">
            <button type="button" className="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Checking…' : 'Turn it on'}</button>
            <button type="button" className="button button--quiet" disabled={busy} onClick={() => { setEnrolling(null); setCode(''); }}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
