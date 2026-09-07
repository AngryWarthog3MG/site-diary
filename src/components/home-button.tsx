'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Home, on every screen but Today itself. Solid, first in the row, so a
 * supervisor three screens deep with gloves on can find it without reading.
 * Keeps the job in hand so Today opens on the same project.
 */
export function HomeButton() {
  const params = useSearchParams();
  const project = params.get('project');
  return (
    <Link className="home-button" href={project ? `/?project=${project}` : '/'} aria-label="Home — Today">
      <span className="home-button__icon" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10.5V20h13v-9.5" />
        </svg>
      </span>
      Home
    </Link>
  );
}
