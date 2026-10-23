'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * The office's own switch (README R165): be told of every order and plant issue raised on the company's jobs, on the
 * phone and by email, and reminded every so many hours while it stays open. One row per person on `order_watchers`,
 * written by the person themselves. Reminders come from the six-hourly sweep; the gap is the row's `every_hours`.
 */
export function WatchOrders({ orgId, userId }: { orgId: string; userId: string }) {
  const [row, setRow] = useState<{ id: string; every_hours: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await createClient().from('order_watchers').select('id, every_hours').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
      if (live) setRow((data as { id: string; every_hours: number } | null) ?? null);
    })();
    return () => { live = false; };
  }, [orgId, userId]);

  async function turn(on: boolean) {
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      if (on) {
        const { data, error: e } = await supabase.from('order_watchers').insert({ org_id: orgId, user_id: userId, every_hours: 6 }).select('id, every_hours').single();
        if (e) throw new Error(/row-level security/i.test(e.message) ? 'Only the office watches the company’s requests.' : e.message);
        setRow(data as { id: string; every_hours: number });
      } else if (row) {
        const { error: e } = await supabase.from('order_watchers').delete().eq('id', row.id);
        if (e) throw new Error(e.message);
        setRow(null);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }
  async function setEvery(hours: number) {
    if (!row) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await createClient().from('order_watchers').update({ every_hours: hours }).eq('id', row.id);
      if (e) throw new Error(e.message);
      setRow({ ...row, every_hours: hours });
    } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); }
    finally { setBusy(false); }
  }

  if (row === undefined) return null;
  return (
    <div className="watch-orders">
      <label className="regs__tick">
        <input type="checkbox" checked={Boolean(row)} disabled={busy} onChange={(e) => void turn(e.target.checked)} />
        <span>Tell me of every request on the company’s jobs — on my phone and by email — and remind me while it stays open</span>
      </label>
      {row && (
        <label className="watch-orders__every">
          <span className="caption">Remind every</span>
          <select className="field field--sm" value={row.every_hours} disabled={busy} onChange={(e) => void setEvery(Number(e.target.value))}>
            {[2, 4, 6, 12, 24].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </label>
      )}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}
