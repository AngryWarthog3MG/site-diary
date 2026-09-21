'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { COMPANY_LABEL, HOME_ITEM, navFor, type NavItem } from '@/lib/nav';
import { onJob } from '@/lib/jobs';
import { JobSwitcher, type SwitchableJob } from '@/components/job-switcher';
import type { MemberRole } from '@/types/database';
import { usePathname, useSearchParams } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';

interface Me {
  name: string | null;
  project: (SwitchableJob & { org: { name: string; code: string } }) | null;
  role: string | null;
  screens?: string[] | null;
  canRecord: boolean;
  projects: SwitchableJob[];
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

  const jobId = me?.project?.id ?? projectParam ?? null;
  // The same list the home page and the rail draw. Until the role is known
  // only the doors every role has are drawn, so nobody sees one close on them.
  const viewer = { role: (me?.role as MemberRole | null) ?? null, screens: me?.screens ?? null, canRecord: Boolean(me?.canRecord), multiJob: (me?.projects.length ?? 0) > 1 };
  const groups = navFor(viewer);
  const item = (it: NavItem, variant?: 'wide') => (
    <Link
      key={it.href}
      className={`navitem${variant === 'wide' ? ' navitem--wide' : ''}`}
      href={onJob(it.href, jobId)}
      onClick={() => setOpen(false)}
    >
      <span className="navitem__name">{it.name}</span>
      <span className="navitem__what">{it.what}</span>
    </Link>
  );

  const drawer = (
    <nav id="app-menu" className="menu-drawer" aria-label="Everything else">
      {me?.project && (
        <div className="menu-drawer__job">
          <JobSwitcher jobs={me.projects.length > 0 ? me.projects : [me.project]} currentId={me.project.id} compact />
        </div>
      )}
      {item(HOME_ITEM, 'wide')}

      {groups.map((group, i) => {
        // "This job" captions the job's headings; the company's one heading names the company itself (README R87).
        const caption = i === 0 && group.scope !== 'company' ? 'This job' : null;
        const heading = group.scope === 'company' && me?.project?.org ? `${COMPANY_LABEL} · ${me.project.org.name}` : group.label;
        return (
          <section key={group.label} className={`navgroup${group.scope === 'company' ? ' navgroup--company' : ''}`}>
            {caption && <p className="navscope">{caption}</p>}
            <p className="label">{heading}</p>
            <div className="navgrid">{group.items.map((it) => item(it))}</div>
          </section>
        );
      })}

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
