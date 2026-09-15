'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { homeHref, recallProject, rememberProject } from '@/lib/project-memory';

/**
 * Home, on every screen but Today itself. Solid, first in the row, so a
 * supervisor three screens deep with gloves on can find it without reading.
 * Keeps the job in hand — from the URL, or the last URL that named one — so
 * Today opens on the same project.
 */
export function HomeButton() {
  const params = useSearchParams();
  const project = params.get('project');
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    rememberProject(project);
    setRemembered(recallProject());
  }, [project]);
  return (
    <Link className="home-button" href={homeHref(project, remembered)} aria-label="Home">
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
