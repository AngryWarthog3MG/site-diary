'use client';

import { useEffect } from 'react';

/**
 * Less on the screen (README R101). Every page opens with a paragraph that
 * explains it; on a phone that is three lines before the first button. The
 * stylesheet clamps `.page-subtitle` to two lines under 700 px; this adds a
 * "more" tap to any subtitle that was actually cut, and nothing to the ones
 * that fit. Runs after each navigation; touches no page markup of its own.
 *
 * It only touches a paragraph React has finished hydrating. A page streamed in
 * under the loading boundary lands in the DOM before React claims it; a button
 * put beside it in that gap makes hydration fail and the whole page redraw on
 * the client (seen on every screen with a long subtitle). React marks a node it
 * owns with a fiber key, so an unclaimed one is left alone and looked at again
 * a moment later.
 */
const owned = (el: Element) => Object.keys(el).some((k) => k.startsWith('__reactFiber'));

export function ReadMore() {
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    const apply = () => {
      let waiting = false;
      for (const p of Array.from(document.querySelectorAll<HTMLParagraphElement>('.page-subtitle'))) {
        if (p.dataset.readmore) continue;
        if (!owned(p)) { waiting = true; continue; }
        if (p.scrollHeight <= p.clientHeight + 2) continue;
        p.dataset.readmore = 'clamped';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'linklike readmore';
        b.textContent = 'more';
        b.addEventListener('click', () => {
          const open = p.classList.toggle('page-subtitle--open');
          b.textContent = open ? 'less' : 'more';
        });
        p.insertAdjacentElement('afterend', b);
      }
      if (retry) { clearTimeout(retry); retry = null; }
      if (waiting && tries < 100) { tries += 1; retry = setTimeout(apply, 50); } else tries = 0;
    };
    apply();
    const obs = new MutationObserver(() => apply());
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', apply);
    window.addEventListener('load', apply);
    return () => { obs.disconnect(); if (retry) clearTimeout(retry); window.removeEventListener('resize', apply); window.removeEventListener('load', apply); };
  }, []);
  return null;
}
