'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { homeHref, recallProject, rememberProject } from '@/lib/project-memory';

/**
 * Home at the foot of every screen. The top bar has one too, but a long
 * screen leaves a person at the bottom with gloves on; this is the button
 * under their thumb when they finish. Keeps the job in hand — from the URL
 * when it has one, from the last URL that did otherwise — so Home opens on
 * the same project. Not on Home itself, nor the public gate and sign-in flows.
 *
 * `at="top"` draws the same button at the head of a screen instead — the site
 * sign-in asked for it: the phone goes hand to hand at the gate and the list
 * below is long, so Home sits where the next person's thumb already is.
 */
export function HomeFoot({ at = 'foot' }: { at?: 'foot' | 'top' } = {}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const project = params.get('project');
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    rememberProject(project);
    setRemembered(recallProject());
  }, [project, pathname]);
  if (pathname === '/' || /^\/(gate|login|auth|verify|offline)/.test(pathname)) return null;
  return (
    <nav className={`homefoot${at === 'top' ? ' homefoot--top' : ''}`} aria-label="Back to home">
      <Link className="homefoot__button" href={homeHref(project, remembered)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10.5V20h13v-9.5" />
        </svg>
        Home
      </Link>
    </nav>
  );
}
