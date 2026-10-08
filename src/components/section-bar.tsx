'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { partsFor, SITE_LABEL, COMPANY_LABEL, type NavGroup, type NavScope } from '@/lib/nav';
import { onJob } from '@/lib/jobs';

/**
 * The heading bar across the top of the home page: Home, then every section
 * heading. Tapping a heading opens a panel under the bar listing what is in
 * it IN PLACE of the tiles — one list on the screen at a time — with an
 * "All sections" button back; Escape does the same. Nothing floats. The groups arrive already
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
  const summary = (g: NavGroup) => g.items.slice(0, 3).map((it) => it.name).join(' · ') + (g.items.length > 3 ? ` · +${g.items.length - 3}` : '');
  return (
    <nav className="secmenu" aria-label="Sections">
      <div className="secmenu__head">
        <p className="label">Sections</p>
        {parts.company.length > 0 && (
          <div className="secmenu__parts" role="tablist" aria-label="This job or the company">
            <button type="button" role="tab" aria-selected={part === 'site'} className={`secmenu__part${part === 'site' ? ' secmenu__part--on' : ''}`} onClick={() => choose('site')}>{SITE_LABEL}</button>
            <button type="button" role="tab" aria-selected={part === 'company'} className={`secmenu__part${part === 'company' ? ' secmenu__part--on' : ''}`} onClick={() => choose('company')}>{COMPANY_LABEL}</button>
          </div>
        )}
      </div>
      {part === 'company' && orgName && <p className="caption secmenu__org">{orgName} · the same on every job</p>}
      {!group && <div className="secmenu__grid">
        {shown.map((g, i) => (
          <button
            key={g.label}
            type="button"
            className={`secmenu__tile${open === i ? ' secmenu__tile--open' : ''}`}
            aria-expanded={open === i}
            aria-controls="secbar-panel"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className="secmenu__name">{g.label}<span className="secmenu__caret" aria-hidden>{open === i ? '▴' : '▾'}</span></span>
            <span className="secmenu__what">{summary(g)}</span>
          </button>
        ))}
      </div>}
      {group && (
        <div id="secbar-panel" className="secmenu__panel">
          <div className="secmenu__panel-head">
            <button type="button" className="secmenu__back" onClick={() => setOpen(null)}><span aria-hidden>‹</span> All sections</button>
            <p className="secmenu__panel-title">{group.label}</p>
          </div>
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
