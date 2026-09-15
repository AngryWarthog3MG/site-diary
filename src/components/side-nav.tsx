'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { RefreshButton } from '@/components/refresh-button';
import { ROLE_LABEL } from '@/lib/roles';
import { HOME_ITEM, NAV_GROUPS, showNav } from '@/lib/nav';
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
  canRecord?: boolean;
  projects?: Array<{ id: string }>;
}

/** The rail lists every section; Settings sits in its foot, and the crew pages live under it. */
const ITEMS = [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)].filter((it) => it.href !== '/settings' && it.when !== 'canRecord');

export function SideNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const projectParam = params.get('project');
  const [me, setMe] = useState<Me | null>(null);

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
  const viewer = { role: me?.role ?? null, canRecord: Boolean(me?.canRecord), multiJob: (me?.projects?.length ?? 0) > 1 };
  const see = (screen: 'settings') => showNav({ href: '/settings', name: '', what: '', screen }, viewer);
  const here = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

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
        {ITEMS.filter((item) => showNav(item, viewer)).map((item) => (
          <li key={item.href}>
            <Link className={`rail__item${here(item.href) ? ' rail__item--here' : ''}`} href={item.href === '/portfolio' ? item.href : `${item.href}${q}`}>
              {item.short ?? item.name}
            </Link>
          </li>
        ))}
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
