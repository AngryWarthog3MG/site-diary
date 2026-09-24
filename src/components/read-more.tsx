'use client';

import { useEffect } from 'react';

/**
 * Less on the screen (README R101). Every page opens with a paragraph that
 * explains it; on a phone that is three lines before the first button. The
 * stylesheet clamps `.page-subtitle` to two lines under 700 px; this adds a
 * "more" tap to any subtitle that was actually cut, and nothing to the ones
 * that fit. Runs after each navigation; touches no page markup of its own.
 */
export function ReadMore() {
  useEffect(() => {
    const apply = () => {
      for (const p of Array.from(document.querySelectorAll<HTMLParagraphElement>('.page-subtitle'))) {
        if (p.dataset.readmore) continue;
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
    };
    apply();
    const obs = new MutationObserver(() => apply());
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', apply);
    return () => { obs.disconnect(); window.removeEventListener('resize', apply); };
  }, []);
  return null;
}
