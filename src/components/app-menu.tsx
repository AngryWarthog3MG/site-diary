'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';

interface Me {
  name: string | null;
  project: { id: string; name: string; code: string } | null;
  role: string | null;
  canRecord: boolean;
  projects: Array<{ id: string; name: string; code: string }>;
}

/**
 * Everything else, behind one button at the top of every screen.
 *
 * The links used to live at the bottom of Today, which meant they were only
 * on Today and only after a scroll. A menu is reachable from anywhere and
 * costs the screen nothing when it is closed. It learns the job and the role
 * once, when first opened, so Members and Vocabulary only appear for the
 * people who can use them.
 */
export function AppMenu() {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const projectParam = params.get('project');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/me${projectParam ? `?project=${projectParam}` : ''}`, { cache: 'no-store' });
      if (res.ok) setMe((await res.json()) as Me);
    } catch {
      // Offline: the menu still opens with the links it can draw without a job.
    }
  }, [projectParam]);

  useEffect(() => {
    if (open && !me) void load();
  }, [open, me, load]);

  // A new screen closes the menu; a new job forgets what it knew.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { setMe(null); }, [projectParam]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (/^\/(signin|login|auth|verify|offline)/.test(pathname)) return null;

  const q = me?.project ? `?project=${me.project.id}` : projectParam ? `?project=${projectParam}` : '';
  const item = (href: string, name: string, what: string) => (
    <Link className="navitem" href={href} onClick={() => setOpen(false)}>
      <span className="navitem__name">{name}</span>
      <span className="navitem__what">{what}</span>
    </Link>
  );

  return (
    <>
      <button
        type="button"
        className={`menu-button${open ? ' menu-button--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="app-menu"
        aria-label={open ? 'Close menu' : 'Menu'}
      >
        <span className="menu-button__icon" aria-hidden>{open ? '×' : '☰'}</span>
        <span>{open ? 'Close' : 'Menu'}</span>
      </button>

      {open && (
        <div className="menu-backdrop" onClick={() => setOpen(false)}>
          <nav id="app-menu" className="menu-panel" aria-label="Everything else" onClick={(e) => e.stopPropagation()}>
            <div className="menu-panel__head">
              <p className="label">{me?.project ? me.project.name : 'KBS Daily Diary'}</p>
              {me?.name && <p className="menu-panel__who mono">{me.name}</p>}
            </div>

            <section className="navgroup">
              {item(`/${q}`, 'Today', 'Record the day, or type it in')}
              {item(`/entries${q}`, 'Past days', 'Every signed day and its PDF, ready to send on')}
              {item(`/reports/weekly${q}`, 'Weekly report', 'The week rolled up the way a PM wants to read it')}
              {item(`/claims${q}`, 'Claims', 'Delays, variations and dayworks gathered up for a claim')}
              {item(`/progress${q}`, 'Progress', 'How far along each area is, over time')}
            </section>

            <section className="navgroup">
              <p className="label">On site</p>
              {item(`/prestart${q}`, 'Prestarts', 'Every morning’s briefing, checks and crew sign-on')}
              {item(`/toolbox${q}`, 'Toolbox talks', 'Run the weekly talk and get the crew to sign on')}
              {item(`/ask${q}`, 'Ask a question', '“How many wet days in August?” — answered from your own diary')}
              {(me?.projects.length ?? 0) > 1 && item('/portfolio', 'All jobs', 'Every active site on one screen')}
            </section>

            <section className="navgroup">
              <p className="label">Setup</p>
              {item(`/settings${q}`, 'Settings', 'Standard hours, who gets the weekly report')}
              {me?.canRecord && item(`/settings/members${q}`, 'Who is on this job', 'Add the crew, or a PM who only reads')}
              {me?.canRecord && item(`/settings/vocabulary${q}`, 'Words and names', 'Names and site terms, so it hears them right')}
            </section>

            <div className="menu-panel__foot">
              <SignOutButton />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
