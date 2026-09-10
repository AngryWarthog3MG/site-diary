'use client';

import { useOutbox } from '@/lib/outbox/use-outbox';
import { KIND_LABEL, type OutboxSummary } from '@/lib/outbox/store';
import * as outbox from '@/lib/outbox/store';

function describe(items: OutboxSummary[]): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, n]) => (n === 1 ? KIND_LABEL[kind as keyof typeof KIND_LABEL] : `${n} ${KIND_LABEL[kind as keyof typeof KIND_LABEL].replace(/^an? /, '')}s`))
    .join(', ');
}

/** What this phone has done without signal and not yet sent. Silent when empty. */
export function OutboxStatus() {
  const { items, online, sending, drain } = useOutbox();
  if (items.length === 0) return null;
  const blocked = items.filter((i) => i.state === 'blocked');
  return (
    <div className={`outbox ${online ? '' : 'outbox--offline'}`} role="status">
      <p className="outbox__line">
        <b>{items.length === 1 ? 'One thing' : `${items.length} things`} waiting on this phone:</b> {describe(items)}.{' '}
        {online ? (sending ? 'Sending…' : 'Sending when you tap or the app wakes.') : 'They will send when you are back in range.'}
      </p>
      {blocked.map((b) => (
        <p key={b.id} className="outbox__blocked">
          {KIND_LABEL[b.kind]} could not be sent: {b.lastError ?? 'refused'}.{' '}
          <button type="button" className="linklike" onClick={() => void outbox.remove(b.id)}>Discard it</button>
        </p>
      ))}
      {online && !sending && items.some((i) => i.state !== 'blocked') && (
        <button type="button" className="button button--outline outbox__send" onClick={() => void drain()}>Send now</button>
      )}
    </div>
  );
}
