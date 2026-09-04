'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * Everything else, behind one Menu button — and a drawer that opens right
 * under it, in the page, pushing what follows down. Not a floating card:
 * the drawer is part of the screen it is on.
 *
 * The button renders where it is placed; the drawer renders into a slot
 * the surrounding header provides (`slotId`), so it can span the header's
 * full width beneath the button row. The menu learns the job and the role
 * once, when first opened, so Members and Vocabulary only appear for the
 * people who can use them.
 */
export function AppMenu({ slotId }: { slotId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const projectParam = params.get('project');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/me${projectParam ? `?project=${projectParam}` : ''}`, { cache: 'no-store' });
      if (res.ok) setMe((await res.json()) as Me);
    } catch {
      // Offline: the drawer still opens with the links it can draw without a job.
    }
  }, [projectParam]);

  useEffect(() => {
    if (open && !me) void load();
  }, [open, me, load]);

  // A new screen closes the drawer; a new job forgets what it knew.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { setMe(null); }, [projectParam]);

  useEffect(() => {
    if (!open) return;
    setSlot(document.getElementById(slotId));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, slotId]);

  if (/^\/(signin|login|auth|verify|offline)/.test(pathname)) return null;

  const q = me?.project ? `?project=${me.project.id}` : projectParam ? `?project=${projectParam}` : '';
  const item = (href: string, name: string, what: string) => (
    <Link className="navitem" href={href} onClick={() => setOpen(false)}>
      <span className="navitem__name">{name}</span>
      <span className="navitem__what">{what}</span>
    </Link>
  );

  const drawer = (
    <nav id="app-menu" className="menu-drawer" aria-label="Everything else">
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
        {item(`/settings${q}`, 'Settings', 'Standard hours, who gets the weekly report, crew and plant lists')}
        {me?.canRecord && item(`/settings/members${q}`, 'Who is on this job', 'Add the crew, or a PM who only reads')}
        {me?.canRecord && item(`/settings/vocabulary${q}`, 'Words and names', 'Names and site terms, so it hears them right')}
      </section>

      <div className="menu-drawer__foot">
        {me?.name && <p className="menu-drawer__who mono">{me.name}</p>}
        <SignOutButton />
      </div>
    </nav>
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
      {open && slot && createPortal(drawer, slot)}
    </>
  );
}
