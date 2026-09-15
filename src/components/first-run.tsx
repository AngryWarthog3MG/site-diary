'use client';

import { useEffect, useState } from 'react';

/**
 * The first time a labourer opens the app: what their two buttons do, in
 * three lines, until they tap Got it. Remembered on the phone; it never comes
 * back and never blocks anything.
 */
export function FirstRun({ role }: { role: string }) {
  const key = `site-diary-first-run:${role}`;
  const [show, setShow] = useState(false);
  useEffect(() => { try { setShow(!window.localStorage.getItem(key)); } catch { setShow(false); } }, [key]);
  if (!show || role !== 'labourer') return null;
  return (
    <section className="firstrun" role="note">
      <p className="label">Welcome — this is all you need</p>
      <ul>
        <li><strong>Sign in / out</strong> — tap it when you arrive and when you leave. That is your time for the day.</li>
        <li><strong>New hazard</strong> — see something unsafe or someone gets hurt, tap it and say what happened. A photo helps.</li>
        <li>The <strong>Home</strong> button at the bottom of every screen brings you back here.</li>
      </ul>
      <button type="button" className="button button--quiet" onClick={() => { try { window.localStorage.setItem(key, '1'); } catch { /* fine */ } setShow(false); }}>Got it</button>
    </section>
  );
}
