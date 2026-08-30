'use client';

import { useEffect, useState } from 'react';
import { localDate } from '@/lib/capture/queue';

/**
 * The provisional reference for the next entry: {ORG}-{device's local date}.
 * Client-side because "today" belongs to the phone, not the server — a Perth
 * evening is already tomorrow in UTC. Rendered after mount so the server and
 * client never disagree about the date mid-hydration.
 */
export function NextEntryLine({ orgCode }: { orgCode: string }) {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localDate()), []);

  return (
    <p className="mono" style={{ margin: '0.25rem 0 0', color: 'var(--ink-60)' }}>
      Next entry · {orgCode}-{today ?? '…'}
    </p>
  );
}
