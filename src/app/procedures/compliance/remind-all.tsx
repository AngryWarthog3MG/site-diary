'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** One button per document on the overview: remind everyone still to sign this version. */
export function RemindAll({ versionId, count }: { versionId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  async function go() {
    setBusy(true); setSaid(null);
    try {
      const r = await fetch('/api/procedures/remind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ versionId }) });
      const j = await r.json().catch(() => ({}));
      setSaid(r.ok ? (j.message ?? 'Reminded.') : (j.message ?? j.error ?? 'That did not go.'));
      if (r.ok) router.refresh();
    } catch { setSaid('That did not go.'); } finally { setBusy(false); }
  }
  return (
    <span className="regs__links">
      <button type="button" className="linklike" disabled={busy} onClick={() => void go()}>{busy ? 'Reminding…' : `Remind ${count}`}</button>
      {said && <span className="caption">{said}</span>}
    </span>
  );
}
