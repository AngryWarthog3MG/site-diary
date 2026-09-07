'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * The docket number that came back after the day was signed. Recorded beside
 * the record through set_daywork_docket(), never onto the signed row; the
 * client sheet and the registers print it as "added after signing".
 */
export function AddDocketButton({ dayworkId, current }: { dayworkId: string; current: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    const ref = window.prompt(current ? `Docket number (currently ${current})` : 'Docket number for this daywork', current ?? '');
    if (ref == null || !ref.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc('set_daywork_docket', { p_daywork_id: dayworkId, p_docket_ref: ref.trim(), p_note: null });
      if (rpcError) throw new Error(rpcError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className={`linklike${current ? '' : ' linklike--amber'}`} type="button" disabled={busy} onClick={add}>
        {busy ? 'Saving…' : current ? 'Change' : 'Add docket'}
      </button>
      {error && <p className="alert">{error}</p>}
    </>
  );
}
