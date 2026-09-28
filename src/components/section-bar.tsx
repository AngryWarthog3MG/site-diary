'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { partsFor, SITE_LABEL, COMPANY_LABEL, type NavGroup, type NavScope } from '@/lib/nav';
import { onJob } from '@/lib/jobs';

/**
 * The heading bar across the top of the home page: Home, then every section
 * heading. Tapping a heading opens a panel under the bar listing what is in
 * it; tapping again, or Escape, closes it. The panel is part of the page and
 * pushes what follows down — nothing floats. The groups arrive already
 * filtered by role from the server, so the bar draws nothing it has to hide.
 */
export function SectionBar({ groups, q, jobId, orgName }: { groups: NavGroup[]; q: string; jobId?: string | null; orgName?: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<number | null>(null);
  // Two parts (README R111): the site's headings, or the company's. Site unless the person last chose Company.
  const parts = partsFor(groups);
  const [part, setPart] = useState<NavScope>('site');
  useEffect(() => {
    try { if (window.sessionStorage.getItem('site-diary-part') === 'company' && parts.company.length > 0) setPart('company'); } catch { /* no storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (next: NavScope) => { setPart(next); setOpen(null); try { window.sessionStorage.setItem('site-diary-part', next); } catch { /* no storage */ } };
  const shown = part === 'company' ? parts.company : parts.site;
  useEffect(() => { setOpen(null); }, [pathname]);
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const group = open == null ? null : shown[open];
  return (
    <nav className="secbar" aria-label="Sections">
      {parts.company.length > 0 && (
        <div className="secbar__parts" role="tablist" aria-label="Site or company">
          <button type="button" role="tab" aria-selected={part === 'site'} className={`secbar__part${part === 'site' ? ' secbar__part--on' : ''}`} onClick={() => choose('site')}>{SITE_LABEL}</button>
          <button type="button" role="tab" aria-selected={part === 'company'} className={`secbar__part${part === 'company' ? ' secbar__part--on' : ''}`} onClick={() => choose('company')}>{orgName ? `${COMPANY_LABEL} · ${orgName}` : COMPANY_LABEL}</button>
        </div>
      )}
      <div className="secbar__row">
        <Link className="secbar__item secbar__item--here" href={`/${q}`}>Home</Link>
        {shown.map((g, i) => (
          <button
            key={g.label}
            type="button"
            className={`secbar__item${open === i ? ' secbar__item--open' : ''}${g.scope === 'company' ? ' secbar__item--company' : ''}`}
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
              <Link key={it.href} className="navitem" href={jobId ? onJob(it.href, jobId) : it.href === '/portfolio' ? it.href : `${it.href}${q}`} onClick={() => setOpen(null)}>
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
