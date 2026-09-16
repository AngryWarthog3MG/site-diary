'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cleanName } from '@/lib/people/name';

export function NameForm({ userId, email, current, first }: { userId: string; email: string | null; current: string; first: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = cleanName(value);
    if (!result.ok) { setError(result.message); return; }
    setBusy(true); setError(null); setSaved(false);
    try {
      const supabase = createClient();
      const { error: e } = await supabase.from('profiles').upsert({ id: userId, email, full_name: result.name }, { onConflict: 'id' });
      if (e) { setError(e.message.includes('profiles_full_name_is_a_name') ? 'Enter a name, not an email address.' : 'That did not save. Check your signal and try again.'); return; }
      await supabase.auth.updateUser({ data: { full_name: result.name } }).catch(() => undefined);
      setValue(result.name);
      if (first) { router.replace('/'); router.refresh(); } else { setSaved(true); router.refresh(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} style={{ marginTop: '1rem' }}>
      <label className="fieldcell">
        <span className="label">Full name</span>
        <input
          id="your-name"
          className="field"
          name="name"
          autoComplete="name"
          autoCapitalize="words"
          autoFocus
          placeholder="First and last name"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        />
      </label>
      {email && <p className="caption">Signed in as {email}. That stays how you sign in; it is not printed.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      {saved && <p className="notice">Saved. New sheets will print {value}.</p>}
      <button type="submit" className="button" disabled={busy || !value.trim()} style={{ marginTop: '0.75rem' }}>
        {busy ? 'Saving…' : first ? 'Continue' : 'Save'}
      </button>
    </form>
  );
}
