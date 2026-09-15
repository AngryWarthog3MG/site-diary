'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { RefreshButton } from '@/components/refresh-button';
import { ROLE_LABEL } from '@/lib/roles';
import { HOME_ITEM, NAV_GROUPS, showNav, type NavGroup } from '@/lib/nav';
import type { MemberRole } from '@/types/database';

/**
 * The desktop rail. On a laptop the job's screens are all one click away and
 * you can see where you are; the phone keeps the drawer, because a rail would
 * eat a third of the screen a supervisor is holding in one hand.
 *
 * Same role table as the drawer and the page guards, so a leading hand sees
 * five doors here and five there.
 */

interface Me {
  name: string | null;
  project: { id: string; name: string; code: string } | null;
  role: MemberRole | null;
  screens?: string[] | null;
  canRecord?: boolean;
  projects?: Array<{ id: string }>;
}

/** The rail draws every heading as a dropdown; Settings sits in its foot, and the crew pages live under it. */
const GROUPS: NavGroup[] = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((it) => it.href !== '/settings' && it.when !== 'canRecord') })).filter((g) => g.items.length > 0);

export function SideNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const projectParam = params.get('project');
  const [me, setMe] = useState<Me | null>(null);
  // Which headings are open. The one holding the current screen opens on its
  // own; a tap on any heading opens or closes it, and that is remembered for
  // the session so a desk that likes everything open keeps it that way.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isHereGroup = (label: string) => GROUPS.find((g) => g.label === label)?.items.some((it) => (it.href === '/' ? pathname === '/' : pathname.startsWith(it.href))) ?? false;
  useEffect(() => {
    try { const saved = window.sessionStorage.getItem('site-diary-rail'); if (saved) setOpen(JSON.parse(saved) as Record<string, boolean>); } catch { /* no storage */ }
  }, []);
  const toggle = (label: string) => setOpen((prev) => {
    const next = { ...prev, [label]: !(prev[label] ?? isHereGroup(label)) };
    try { window.sessionStorage.setItem('site-diary-rail', JSON.stringify(next)); } catch { /* no storage */ }
    return next;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/me${projectParam ? `?project=${projectParam}` : ''}`, { cache: 'no-store' });
        if (res.ok && !cancelled) setMe((await res.json()) as Me);
      } catch {
        // Offline: the rail still draws its links.
      }
    })();
    return () => { cancelled = true; };
  }, [projectParam]);

  if (/^\/(signin|login|auth|verify|offline)/.test(pathname)) return null;

  const q = me?.project ? `?project=${me.project.id}` : projectParam ? `?project=${projectParam}` : '';
  const viewer = { role: me?.role ?? null, screens: me?.screens ?? null, canRecord: Boolean(me?.canRecord), multiJob: (me?.projects?.length ?? 0) > 1 };
  const see = (screen: 'settings') => showNav({ href: '/settings', name: '', what: '', screen }, viewer);
  const here = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const isOpen = (label: string) => open[label] ?? isHereGroup(label);

  return (
    <nav className="rail" aria-label="Sections">
      <Link className="rail__brand" href={`/${q}`}>
        <BrandMark size={22} />
        <span>Daily Diary</span>
      </Link>

      {me?.project && (
        <div className="rail__job">
          <span className="label">Job</span>
          <span className="rail__jobname">{me.project.name}</span>
          <span className="mono rail__jobcode">{me.project.code}</span>
        </div>
      )}

      <ul className="rail__list">
        <li>
          <Link className={`rail__item${here('/') ? ' rail__item--here' : ''}`} href={`/${q}`}>{HOME_ITEM.name}</Link>
        </li>
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => showNav(item, viewer));
          if (items.length === 0) return null;
          const opened = isOpen(group.label);
          const holdsHere = isHereGroup(group.label);
          return (
            <li key={group.label} className={`rail__group${opened ? ' rail__group--open' : ''}`}>
              <button
                type="button"
                className={`rail__head${holdsHere ? ' rail__head--here' : ''}`}
                aria-expanded={opened}
                aria-controls={`rail-${group.label}`}
                onClick={() => toggle(group.label)}
              >
                <span>{group.label}</span>
                <span className="rail__caret" aria-hidden>▾</span>
              </button>
              {opened && (
                <ul id={`rail-${group.label}`} className="rail__sub">
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link className={`rail__item${here(item.href) ? ' rail__item--here' : ''}`} href={item.href === '/portfolio' ? item.href : `${item.href}${q}`}>
                        {item.short ?? item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="rail__foot">
        {see('settings') && (
          <Link className={`rail__item rail__item--quiet${here('/settings') ? ' rail__item--here' : ''}`} href={`/settings${q}`}>
            Settings
          </Link>
        )}
        <RefreshButton />
        {me?.name && <p className="rail__who mono">{me.name}{me.role ? ` · ${ROLE_LABEL[me.role]}` : ''}</p>}
      </div>
    </nav>
  );
}
