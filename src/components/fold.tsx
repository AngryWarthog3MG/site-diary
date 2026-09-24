'use client';

import { useState } from 'react';

/**
 * Less on the screen (README R101): a block that opens on a tap. `phoneOnly`
 * folds it under 700 px and shows it as it was on a desk; without it the
 * block is folded everywhere. The label says what is inside and how much,
 * so nothing is hidden without being named.
 */
export function Fold({ label, count, phoneOnly = false, children }: { label: string; count?: number; phoneOnly?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fold${phoneOnly ? ' fold--phone' : ''}${open ? ' fold--open' : ''}`}>
      <button type="button" className="fold__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{label}{count != null ? ` · ${count}` : ''}</span>
        <span className="fold__act">{open ? 'Hide' : 'Show'}</span>
      </button>
      <div className="fold__body">{children}</div>
    </div>
  );
}
