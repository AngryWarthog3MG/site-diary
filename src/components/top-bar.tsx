'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { AppMenu } from '@/components/app-menu';
import { RefreshButton } from '@/components/refresh-button';

/**
 * The bar across the top of every screen: the mark on the left, Menu and
 * Refresh on the right. Part of the page, not floating over it — it sits in
 * the flow and stays put when you scroll, so the header underneath it is
 * never half-covered by a button.
 */
export function TopBar() {
  const pathname = usePathname();
  // Today carries Menu and Refresh in its own green header, under the
  // serial; everywhere else they live in this bar.
  if (pathname === '/' || /^\/(signin|login|auth|verify|offline)/.test(pathname)) return null;

  return (
    <header className="topbar">
      <Link className="topbar__brand" href="/" aria-label="Today">
        <BrandMark size={22} />
        <span>Daily Diary</span>
      </Link>
      <div className="topbar__actions">
        <Suspense fallback={null}>
          <AppMenu />
        </Suspense>
        <RefreshButton />
      </div>
    </header>
  );
}
