'use client';

import { useEffect, useState } from 'react';
import * as outbox from './store';
import type { OutboxKind, OutboxSummary } from './store';

/**
 * What is still waiting on this phone for one screen — so a note made with no
 * signal shows at once, marked as not yet sent, instead of vanishing until the
 * phone is back in range (README R76).
 */
export function usePending(kind: OutboxKind, subjectOrProject: string, by: 'subject' | 'project' = 'subject'): OutboxSummary[] {
  const [items, setItems] = useState<OutboxSummary[]>([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const all = await outbox.summaries().catch(() => [] as OutboxSummary[]);
      if (live) setItems(all.filter((i) => i.kind === kind && (by === 'subject' ? i.subjectId : i.projectId) === subjectOrProject));
    };
    void load();
    const stop = outbox.onOutboxChange(() => void load());
    return () => { live = false; stop(); };
  }, [kind, subjectOrProject, by]);
  return items;
}
