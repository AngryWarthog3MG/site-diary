'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Six digits, checked against the person's authenticator; the session moves to the second level (README R106). */
export function VerifyCode({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) { setError('The code is six digits.'); return; }
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const { data: list, error: lErr } = await supabase.auth.mfa.listFactors();
      if (lErr) throw new Error(lErr.message);
      const factor = list?.totp?.[0];
      if (!factor) { router.replace(`/security?next=${encodeURIComponent(next)}`); return; }
      const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: clean });
      if (vErr) throw new Error(/invalid|expired/i.test(vErr.message) ? 'That code did not match. Try the one showing now.' : vErr.message);
      router.replace(next);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); setBusy(false); }
  }

  return (
    <div className="security">
      {error && <p className="alert">{error}</p>}
      <label className="fieldcell" htmlFor="verify-code">
        <span className="label">Code</span>
        <input id="verify-code" className="field security__code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} placeholder="123456"
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </label>
      <button type="button" className="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Checking…' : 'Continue'}</button>
      <p className="caption security__skip"><Link href={next}>Not now</Link> — the app works; the money stays hidden until you enter it.</p>
    </div>
  );
}
