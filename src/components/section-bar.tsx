'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavGroup } from '@/lib/nav';

/**
 * The heading bar across the top of the home page: Home, then every section
 * heading. Tapping a heading opens a panel under the bar listing what is in
 * it; tapping again, or Escape, closes it. The panel is part of the page and
 * pushes what follows down — nothing floats. The groups arrive already
 * filtered by role from the server, so the bar draws nothing it has to hide.
 */
export function SectionBar({ groups, q }: { groups: NavGroup[]; q: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { setOpen(null); }, [pathname]);
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const group = open == null ? null : groups[open];
  return (
    <nav className="secbar" aria-label="Sections">
      <div className="secbar__row">
        <Link className="secbar__item secbar__item--here" href={`/${q}`}>Home</Link>
        {groups.map((g, i) => (
          <button
            key={g.label}
            type="button"
            className={`secbar__item${open === i ? ' secbar__item--open' : ''}`}
            aria-expanded={open === i}
            aria-controls="secbar-panel"
            onClick={() => setOpen(open === i ? null : i)}
          >
            {g.label}<span className="secbar__caret" aria-hidden>▾</span>
          </button>
        ))}
      </div>
      {group && (
        <div id="secbar-panel" className="secbar__panel">
          <div className="navgrid">
            {group.items.map((it) => (
              <Link key={it.href} className="navitem" href={it.href === '/portfolio' ? it.href : `${it.href}${q}`} onClick={() => setOpen(null)}>
                <span className="navitem__name">{it.name}</span>
                <span className="navitem__what">{it.what}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
