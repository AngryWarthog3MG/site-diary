'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Home at the foot of every screen. The top bar has one too, but a long
 * screen leaves a person at the bottom with gloves on; this is the button
 * under their thumb when they finish. Keeps the job in hand so Home opens on
 * the same project. Not on Home itself, nor the public gate and sign-in flows.
 */
export function HomeFoot() {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname === '/' || /^\/(gate|login|auth|verify|offline)/.test(pathname)) return null;
  const project = params.get('project');
  return (
    <nav className="homefoot" aria-label="Back to home">
      <Link className="homefoot__button" href={project ? `/?project=${project}` : '/'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10.5V20h13v-9.5" />
        </svg>
        Home
      </Link>
    </nav>
  );
}
